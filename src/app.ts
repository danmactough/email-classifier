import { createReadStream } from "node:fs";
import { pathToFileURL } from "node:url";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { classifyEmail, resolveMaxBodyChars } from "./classify.ts";
import { parseMbox } from "./mbox.ts";
import { buildQuestions } from "./questions.ts";
import { openReport } from "./report.ts";
import type { ClassifiedEmail, ParsedEmail, ParseError, RunSummary } from "./types.ts";


try {
  process.loadEnvFile();
} catch {
  // no .env file present; rely on the ambient environment
}

const FROM_FILTER = new RegExp(process.env.FROM_FILTER ?? ".*", 'i');
const DATE_FILTER = new RegExp(process.env.DATE_FILTER ?? ".*", 'i');
const SUBJECT_FILTER = new RegExp(process.env.SUBJECT_FILTER ?? ".*", 'i');
const BODY_FILTER = new RegExp(process.env.BODY_FILTER ?? ".*", 'is');
const DATE_SINCE = new Date(process.env.DATE_SINCE ?? "1970-01-01T00:00:00Z");

/** True when an email matches the FILTER regex on any of its fields. */
export function shouldClassify(email: ParsedEmail): boolean {
  const dateOk = email.dateParsed != null && email.dateParsed >= DATE_SINCE && DATE_FILTER.test(email.date);
  const fromOk = FROM_FILTER.test(email.from);
  const subjectOk = SUBJECT_FILTER.test(email.subject);
  const bodyOk = BODY_FILTER.test(email.body);
  if (process.env.LOG_SKIPPED) {
    const failMsgs: string[] = [];
    if (!dateOk) failMsgs.push(`date ${email.date} < ${DATE_SINCE.toISOString()}`);
    if (!fromOk) failMsgs.push(`from ${email.from} !~ ${FROM_FILTER}`);
    if (!subjectOk) failMsgs.push(`subject ${email.subject} !~ ${SUBJECT_FILTER}`);
    if (!bodyOk) failMsgs.push(`body !~ ${BODY_FILTER}`);
    if (failMsgs.length > 0) console.error("skipping", email.messageId, email.from, email.subject, failMsgs.join("; "));
  }
  return dateOk && fromOk && subjectOk && bodyOk;
}

/** True when classification is enabled: CLASSIFIER is set to a name. */
export function isClassifierEnabled(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.CLASSIFIER?.trim());
}

/** Entrypoint: stream mbox, parse, filter, classify, console.log the report. */
export async function main(): Promise<void> {
  const path = process.argv[2] ?? process.env.MBOX_PATH;
  if (!path) throw new Error("usage: tsx src/app.ts <mbox-path>");

  const classifier = process.env.CLASSIFIER?.trim() || null;
  const client = isClassifierEnabled(process.env) ? new TypeSafeClient() : null;
  const maxBodyChars = resolveMaxBodyChars(process.env);
  const startedAt = new Date();
  const writer = await openReport({
    meta: { source: path, classifier, startedAt },
  });

  const summary: RunSummary = { total: 0, success: 0, error: 0 };
  const errors: ParseError[] = [];
  const classified: ClassifiedEmail[] = [];
  let matched = 0;
  let classificationMs = 0;
  let classificationErrors = 0;

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
    let durationMs: number | null = null;
    let failure: string | null = null;
    let truncated = false;
    if (client) {
      const started = performance.now();
      try {
        const email = await classifyEmail({
          client,
          email: item.email,
          questions: buildQuestions({ email: item.email }),
          maxBodyChars,
        });
        durationMs = performance.now() - started;
        classificationMs += durationMs;
        classified.push(email);
        result = email.result;
        truncated = email.truncated;
      } catch (cause) {
        durationMs = performance.now() - started;
        classificationErrors += 1;
        failure = cause instanceof Error ? cause.message : String(cause);
        console.error("classification failed", item.email.messageId, cause);
      }
    }
    await writer.addRow({
      email: item.email,
      result,
      durationMs,
      error: failure,
      truncated,
    });
  }

  console.log("summary", JSON.stringify(summary));
  for (const error of errors) {
    console.error(`[${error.reason}] ${error.detail} :: ${error.snippet}`);
  }
  console.error(`matched ${matched} of ${summary.success}`);
  if (classificationErrors > 0) {
    console.error("classification errors", classificationErrors);
  }

  await writer.close({
    ...summary,
    matched,
    elapsedMs: Date.now() - startedAt.getTime(),
    classificationMs,
    classified: classified.length,
    classificationErrors,
  });
  console.error("report", writer.path);

  if (!client) {
    console.error(
      "dry run: set CLASSIFIER (in .env) to send matched emails to the classifier"
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
