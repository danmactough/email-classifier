import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";

/** One message extracted from an mbox archive. */
export interface ParsedEmail {
  /** Message-ID header value; unique identity for the email. */
  messageId: string;
  /** Raw From: header value. */
  from: string;
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

/** One email plus everything Jev returned for it. */
export interface ClassifiedEmail {
  /** Set from `email.messageId`. */
  id: string;
  email: ParsedEmail;
  /** Full SDK response: model, typed answers, token usage. */
  result: SystemOneResult<Questions>;
}

/** Counts for the run. */
export interface RunSummary {
  total: number;
  success: number;
  error: number;
}
