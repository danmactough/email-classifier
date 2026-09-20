import { createReadStream } from "node:fs";
import { pathToFileURL } from "node:url";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { classifyEmail } from "./classify.ts";
import { parseMbox } from "./mbox.ts";
import { buildQuestions } from "./questions.ts";
import { openReport } from "./report.ts";
import type { ClassifiedEmail, ParsedEmail, ParseError, RunSummary } from "./types.ts";

const FILTER = /invoice|receipt/i;

/** True when an email matches the FILTER regex on any of its fields. */
export function shouldClassify(email: ParsedEmail): boolean {
  if (FILTER.test(email.from)) return true;
  if (FILTER.test(email.date)) return true;
  if (FILTER.test(email.subject)) return true;
  if (FILTER.test(email.body)) return true;
  return false;
}

/** True only when JEV_LIVE is explicitly enabled. */
export function isLiveEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.JEV_LIVE === "1";
}

/** Entrypoint: stream mbox, parse, filter, classify, console.log the report. */
export async function main(): Promise<void> {
  const path = process.argv[2] ?? process.env.MBOX_PATH;
  if (!path) throw new Error("usage: tsx src/app.ts <mbox-path>");

  try {
    process.loadEnvFile();
  } catch {
    // no .env file present; rely on the ambient environment
  }

  const client = isLiveEnabled(process.env) ? new TypeSafeClient() : null;
  const startedAt = new Date();
  const writer = await openReport({
    meta: { source: path, live: client !== null, startedAt },
  });

  const summary: RunSummary = { total: 0, success: 0, error: 0 };
  const errors: ParseError[] = [];
  const classified: ClassifiedEmail[] = [];
  let matched = 0;

  const source = createReadStream(path, { encoding: "utf8" });
  for await (const item of parseMbox(source)) {
    summary.total += 1;
    if (!item.ok) {
      summary.error += 1;
      errors.push(item.error);
      continue;
    }
    summary.success += 1;
    if (!shouldClassify(item.email)) continue;
    matched += 1;
    let result: ClassifiedEmail["result"] | null = null;
    if (client) {
      try {
        const email = await classifyEmail({
          client,
          email: item.email,
          questions: buildQuestions({ email: item.email }),
        });
        classified.push(email);
        result = email.result;
      } catch (error) {
        console.error("classification failed", item.email.messageId, error);
      }
    }
    await writer.addRow({ email: item.email, result });
  }

  console.log("summary", JSON.stringify(summary));
  for (const error of errors) {
    console.log(`[${error.reason}] ${error.detail} :: ${error.snippet}`);
  }
  console.log(`matched ${matched} of ${summary.success}`);

  await writer.close({ ...summary, matched });
  console.log("report", writer.path);

  if (!client) {
    console.log(
      "dry run: set JEV_LIVE=1 (in .env) to send matched emails to Jev"
    );
    return;
  }

  for (const item of classified) {
    console.log(item.id, JSON.stringify(item.result.answers));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
