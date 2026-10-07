import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { MboxItem } from "./types.ts";
import { parseMbox, splitMessages } from "./mbox.ts";

// simpleParser is tolerant of malformed input, so the only way to exercise the
// parse-failed path is to force the dependency to throw.
vi.mock("mailparser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mailparser")>();
  return {
    ...actual,
    simpleParser: vi.fn(async (raw: string) => {
      if (raw.includes("BOOM")) throw new Error("kaboom");
      return actual.simpleParser(raw);
    }),
  };
});

async function* chunked(parts: string[]): AsyncGenerator<string> {
  for (const part of parts) yield part;
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

function emailsOf(items: MboxItem[]) {
  return items.map((item) => {
    if (!item.ok) throw new Error(`unexpected drop: ${item.error.reason}`);
    return item.email;
  });
}

describe("splitMessages", () => {
  it("yields one raw message per From separator, reassembling chunk splits", async () => {
    const archive = "From a@x\nA1\nA2\n\nFrom b@x\nB1";

    const messages = await collect(splitMessages(chunked([...archive])));

    expect(messages).toEqual(["A1\nA2\n", "B1"]);
  });
});

describe("parseMbox", () => {
  it("yields each parsed email in order, unescaping >From lines", async () => {
    const archive = [
      "From alice@example.com Mon Jan 03 09:12:00 2022",
      "Message-ID: <a@example.com>",
      "From: Alice <alice@example.com>",
      "Subject: Hello",
      "Date: Mon, 3 Jan 2022 09:12:00 -0500",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      ">From the beginning.",
      "",
      "From bob@example.com Tue Feb 01 10:00:00 2022",
      "Message-ID: <b@example.com>",
      "From: Bob <bob@example.com>",
      "Subject: Second",
      "Date: Tue, 1 Feb 2022 10:00:00 -0500",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      "Second body.",
    ].join("\n");

    const items = await collect(parseMbox(chunked([archive])));
    const emails = emailsOf(items);

    expect(emails.map((email) => email.messageId)).toEqual([
      "<a@example.com>",
      "<b@example.com>",
    ]);
    expect(emails[0].subject).toBe("Hello");
    expect(emails[0].fromParsed.name).toBe("Alice");
    expect(emails[0].date).toBe("Mon, 3 Jan 2022 09:12:00 -0500");
    expect(emails[0].dateParsed?.toISOString()).toBe("2022-01-03T14:12:00.000Z");
    expect(emails[0].body).toContain("From the beginning.");
    expect(emails[0].body).not.toContain(">From");
  });

  it("yields a missing-message-id item and keeps iterating", async () => {
    const archive = [
      "From alice@example.com Mon Jan 03 09:12:00 2022",
      "Message-ID: <keep@example.com>",
      "From: Alice <alice@example.com>",
      "Subject: Keep",
      "Date: Mon, 3 Jan 2022 09:12:00 -0500",
      "",
      "Kept body.",
      "",
      "From nobody@example.com Tue Feb 01 10:00:00 2022",
      "From: Nobody <nobody@example.com>",
      "Subject: No id",
      "Date: Tue, 1 Feb 2022 10:00:00 -0500",
      "",
      "Dropped body.",
    ].join("\n");

    const items = await collect(parseMbox(chunked([archive])));

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ ok: true, email: { messageId: "<keep@example.com>" } });
    expect(items[1]).toMatchObject({
      ok: false,
      error: { reason: "missing-message-id" },
    });
    if (!items[1].ok) expect(items[1].error.snippet).toContain("Dropped body");
  });

  it("yields parse-failed and continues when a message fails to parse", async () => {
    const archive = [
      "From alice@example.com Mon Jan 03 09:12:00 2022",
      "Message-ID: <ok@example.com>",
      "From: Alice <alice@example.com>",
      "Subject: Fine",
      "Date: Mon, 3 Jan 2022 09:12:00 -0500",
      "",
      "Fine body.",
      "",
      "From boom@example.com Tue Feb 01 10:00:00 2022",
      "Message-ID: <bad@example.com>",
      "From: Boom <boom@example.com>",
      "Subject: Boom",
      "Date: Tue, 1 Feb 2022 10:00:00 -0500",
      "",
      "BOOM",
    ].join("\n");

    const items = await collect(parseMbox(chunked([archive])));

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ ok: true, email: { messageId: "<ok@example.com>" } });
    expect(items[1]).toMatchObject({
      ok: false,
      error: { reason: "parse-failed", detail: "kaboom" },
    });
  });

  it("keeps HTML in htmlBody and still yields usable text in body", async () => {
    const htmlOnly = [
      "From shop@example.com Tue Feb 01 10:00:00 2022",
      "Message-ID: <html@example.com>",
      "From: Shop <shop@example.com>",
      "Subject: Rich",
      "Date: Tue, 1 Feb 2022 10:00:00 -0500",
      'Content-Type: text/html; charset="utf-8"',
      "",
      "<html><body><p>Total: <b>$19.99</b></p></body></html>",
    ].join("\n");

    const emails = emailsOf(await collect(parseMbox(chunked([htmlOnly]))));

    expect(emails).toHaveLength(1);
    expect(emails[0].htmlBody).toContain("<b>$19.99</b>");
    expect(emails[0].body).toContain("$19.99");
    expect(emails[0].body).not.toContain("<b>");
  });

  it("parses the full fixture archive and reports the message with no Message-ID", async () => {
    const contents = await readFile(
      new URL("./__fixtures__/sample.mbox", import.meta.url),
      "utf8"
    );

    const items = await collect(parseMbox(chunked([contents])));
    const emails = items.filter((item) => item.ok).map((item) => item.email);
    const errors = items.filter((item) => !item.ok).map((item) => item.error);

    expect(emails.map((email) => email.messageId)).toEqual([
      "<invoice-001@example.com>",
      "<receipt-002@example.com>",
      "<escaped-004@example.com>",
      "<broken-005@example.com>",
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toBe("missing-message-id");
    expect(items).toHaveLength(5);
  });
});
