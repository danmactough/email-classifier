/** One generic question: what to ask about the email, in a classifier-neutral shape. */
export type Question =
  | {
      kind: "binary";
      name: string;
      question: string;
      criteria?: { true: string; false: string };
    }
  | {
      kind: "score";
      name: string;
      question: string;
      /** Rubric levels ordered lowest to highest; the description is the criterion. */
      levels: Array<{ label: string; description: string }>;
    }
  | {
      kind: "select";
      name: string;
      question: string;
      options: Array<{ value: string; description?: string }>;
    };

/** The classifier-neutral answer the report renders for one question. */
export type Answer =
  | { name: string; kind: "probability"; value: number }
  | {
      name: string;
      kind: "score";
      value: number;
      confidence: number;
      /** The highest rubric index; the score scale is 0 to max. */
      max: number;
    }
  | { name: string; kind: "select"; value: string; confidence: number }
  | { name: string; kind: "refusal" };

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
export type MboxItem = { ok: true; email: ParsedEmail } | { ok: false; error: ParseError };

/** One email plus the classifier's answers for it, in the generic format. */
export interface ClassifiedEmail {
  /** Set from `email.messageId`. */
  id: string;
  email: ParsedEmail;
  answers: Answer[];
  /** True when the body was trimmed to fit the classifier's input budget. */
  truncated: boolean;
}

/** Counts for the run. */
export interface RunSummary {
  total: number;
  success: number;
  error: number;
}
