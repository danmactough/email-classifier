import { simpleParser, type ParsedMail } from "mailparser";
import type { ParsedEmail, ParseError } from "./types.ts";

const SNIPPET_LENGTH = 200;

function snippet(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, SNIPPET_LENGTH);
}

/** Split an mbox archive into raw messages on `From ` separator lines. */
function splitMessages(contents: string): string[] {
  const messages: string[] = [];
  let current: string[] = [];
  for (const line of contents.split(/\r?\n/)) {
    if (/^From /.test(line)) {
      if (current.length > 0) messages.push(current.join("\n"));
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) messages.push(current.join("\n"));
  return messages;
}

/** Undo mboxrd `>From ` escaping so the parser sees the original text. */
function unescapeFromLines(message: string): string {
  return message
    .split("\n")
    .map((line) => (/^>+From /.test(line) ? line.slice(1) : line))
    .join("\n");
}

/** Recover a raw header value (e.g. the original Date: string) from header lines. */
function rawHeaderLine(parsed: ParsedMail, name: string): string {
  const found = parsed.headerLines.find(
    (header) => header.key.toLowerCase() === name
  );
  if (!found) return "";
  return found.line.slice(found.line.indexOf(":") + 1).trim();
}

/**
 * Split an mbox archive into individual messages and parse each one.
 * Messages missing a Message-ID are skipped and reported.
 */
export async function parseMbox(
  contents: string
): Promise<{ emails: ParsedEmail[]; errors: ParseError[] }> {
  const emails: ParsedEmail[] = [];
  const errors: ParseError[] = [];

  for (const raw of splitMessages(contents).map(unescapeFromLines)) {
    let parsed: ParsedMail;
    try {
      parsed = await simpleParser(raw);
    } catch (error) {
      errors.push({
        reason: "parse-failed",
        detail: error instanceof Error ? error.message : String(error),
        snippet: snippet(raw),
      });
      continue;
    }

    if (!parsed.messageId) {
      errors.push({
        reason: "missing-message-id",
        detail: "message has no Message-ID header",
        snippet: snippet(raw),
      });
      continue;
    }

    emails.push({
      messageId: parsed.messageId,
      from: parsed.from?.text ?? "",
      date: rawHeaderLine(parsed, "date"),
      dateParsed: parsed.date ?? null,
      subject: parsed.subject ?? "",
      body: parsed.text ?? "",
      htmlBody: typeof parsed.html === "string" ? parsed.html : null,
      raw,
    });
  }

  return { emails, errors };
}
