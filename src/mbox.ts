import { simpleParser, type ParsedMail } from "mailparser";
import { displayName } from "./helpers.ts";
import type { MboxItem, ParsedEmail, ParseError } from "./types.ts";

const SNIPPET_LENGTH = 200;

function snippet(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, SNIPPET_LENGTH);
}

/** Yield complete lines from a stream of arbitrary text chunks. */
async function* lines(source: AsyncIterable<string>): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of source) {
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      yield line;
    }
  }
  let line = buffer;
  if (line.endsWith("\r")) line = line.slice(0, -1);
  yield line;
}

/** Split a stream of text chunks into raw messages, one per mbox `From ` separator. */
export async function* splitMessages(
  source: AsyncIterable<string>
): AsyncGenerator<string> {
  let current: string[] = [];
  for await (const line of lines(source)) {
    if (/^From /.test(line)) {
      if (current.length > 0) yield current.join("\n");
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) yield current.join("\n");
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
 * Parse each message from the source and yield a ParsedEmail or ParseError.
 * Messages missing a Message-ID are skipped and reported.
 */
export async function* parseMbox(
  source: AsyncIterable<string>
): AsyncGenerator<MboxItem> {
  for await (const raw of splitMessages(source)) {
    const message = unescapeFromLines(raw);

    let parsed: ParsedMail;
    try {
      parsed = await simpleParser(message);
    } catch (error) {
      yield {
        ok: false,
        error: {
          reason: "parse-failed",
          detail: error instanceof Error ? error.message : String(error),
          snippet: snippet(message),
        },
      };
      continue;
    }

    if (!parsed.messageId) {
      yield {
        ok: false,
        error: {
          reason: "missing-message-id",
          detail: "message has no Message-ID header",
          snippet: snippet(message),
        },
      };
      continue;
    }

    yield {
      ok: true,
      email: {
        messageId: parsed.messageId,
        from: parsed.from?.text ?? "",
        fromParsed: { name: displayName(parsed.from?.text ?? "") },
        date: rawHeaderLine(parsed, "date"),
        dateParsed: parsed.date ?? null,
        subject: parsed.subject ?? "",
        body: parsed.text ?? "",
        htmlBody: typeof parsed.html === "string" ? parsed.html : null,
        raw: message,
      },
    };
  }
}
