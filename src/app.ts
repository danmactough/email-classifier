import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { classifyEmail } from "./classify.ts";
import { parseMbox } from "./mbox.ts";
import type { ClassifiedEmail, ParsedEmail, RunSummary } from "./types.ts";

const FILTER = /invoice|receipt/i;

/** Ad-hoc filtering. Criteria live here as plain if/else. */
export function selectEmails(emails: ParsedEmail[]): ParsedEmail[] {
  return emails.filter((email) => {
    if (FILTER.test(email.from)) return true;
    if (FILTER.test(email.date)) return true;
    if (FILTER.test(email.subject)) return true;
    if (FILTER.test(email.body)) return true;
    return false;
  });
}

/** True only when JEV_LIVE is explicitly enabled. */
export function isLiveEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.JEV_LIVE === "1";
}

/** Entrypoint: read mbox, parse, filter, classify, console.log the report. */
export async function main(): Promise<void> {
  const path = process.argv[2] ?? process.env.MBOX_PATH;
  if (!path) throw new Error("usage: tsx src/app.ts <mbox-path>");

  try {
    process.loadEnvFile();
  } catch {
    // no .env file present; rely on the ambient environment
  }

  const contents = await readFile(path, "utf8");
  const { emails, errors } = await parseMbox(contents);

  const summary: RunSummary = {
    total: emails.length + errors.length,
    success: emails.length,
    error: errors.length,
  };
  console.log("summary", JSON.stringify(summary));
  for (const error of errors) {
    console.log(`[${error.reason}] ${error.detail} :: ${error.snippet}`);
  }

  const selected = selectEmails(emails);
  console.log(`matched ${selected.length} of ${emails.length}`);

  if (!isLiveEnabled(process.env)) {
    console.log(
      "dry run: set JEV_LIVE=1 (in .env) to send matched emails to Jev"
    );
    return;
  }

  const client = new TypeSafeClient();
  const questions = {
    category: choice("What kind of email is this?", {
      personal: null,
      work: null,
      other: null,
    }),
  };

  const classified: ClassifiedEmail[] = [];
  for (const email of selected) {
    try {
      classified.push(await classifyEmail({ client, email, questions }));
    } catch (error) {
      console.error("classification failed", email.messageId, error);
    }
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
