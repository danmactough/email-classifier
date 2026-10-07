import type { SystemOneResult } from "@typesafe-ai/sdk";
import type { EmailQuestions } from "./questions.ts";

/** One message extracted from an mbox archive. */
export interface ParsedEmail {
  /** Message-ID header value; unique identity for the email. */
  messageId: string;
  /** Raw From: header value. */
  from: string;
  /** From header after parsing: the display name, or "" when absent. */
  fromParsed: { name: string };
  /** Raw Date: header value. */
  date: string;
  /** Parsed Date, or null if the header is missing/unparseable. */
  dateParsed: Date | null;
  /** Raw Subject: header value. */
  subject: string;
  /** Decoded plain-text body. */
  body: string;
  /** Decoded rich body, or null when absent. */
  htmlBody: string | null;
  /** The complete text of the message as handed to the parser. */
  raw: string;
}

/** A message that could not be turned into a ParsedEmail. */
export interface ParseError {
  reason: "missing-message-id" | "parse-failed";
  /** Human-readable detail. */
  detail: string;
  /** First ~200 chars of the raw message. */
  snippet: string;
}

/** One item yielded by parseMbox: a parsed email, or a reason it was dropped. */
export type MboxItem =
  | { ok: true; email: ParsedEmail }
  | { ok: false; error: ParseError };

/** One email plus everything Jev returned for it. */
export interface ClassifiedEmail {
  /** Set from `email.messageId`. */
  id: string;
  email: ParsedEmail;
  /** Full SDK response: model, typed answers, token usage. */
  result: SystemOneResult<EmailQuestions>;
  /** True when the body was trimmed to fit the API token budget. */
  truncated: boolean;
}

/** Counts for the run. */
export interface RunSummary {
  total: number;
  success: number;
  error: number;
}
