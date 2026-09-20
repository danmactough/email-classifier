import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { parseMbox } from "./mbox.ts";

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

const TWO_MESSAGES = [
  "From alice@example.com Mon Jan 03 09:12:00 2022",
  "Message-ID: <a@example.com>",
  "From: Alice <alice@example.com>",
  "Subject: Hello",
  "Date: Mon, 3 Jan 2022 09:12:00 -0500",
  'Content-Type: text/plain; charset="utf-8"',
  "",
  "First body.",
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

describe("parseMbox", () => {
  it("returns one ParsedEmail per message with decoded headers and body", async () => {
    const { emails, errors } = await parseMbox(TWO_MESSAGES);

    expect(errors).toEqual([]);
    expect(emails).toHaveLength(2);
    expect(emails[0]).toMatchObject({
      messageId: "<a@example.com>",
      subject: "Hello",
      body: "First body.\n",
    });
    expect(emails[0].from).toContain("alice@example.com");
    expect(emails[0].date).toBe("Mon, 3 Jan 2022 09:12:00 -0500");
    expect(emails[0].dateParsed?.toISOString()).toBe("2022-01-03T14:12:00.000Z");
    expect(emails[1].messageId).toBe("<b@example.com>");
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

    const { emails } = await parseMbox(htmlOnly);

    expect(emails).toHaveLength(1);
    expect(emails[0].htmlBody).toContain("<b>$19.99</b>");
    expect(emails[0].body).toContain("$19.99");
    expect(emails[0].body).not.toContain("<b>");
  });
  it("does not split on and unescapes a >From line", async () => {
    const escaped = [
      "From alice@example.com Mon Jan 03 09:12:00 2022",
      "Message-ID: <esc@example.com>",
      "From: Alice <alice@example.com>",
      "Subject: Escaped",
      "Date: Mon, 3 Jan 2022 09:12:00 -0500",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      ">From the beginning.",
      "Regular line.",
    ].join("\n");

    const { emails } = await parseMbox(escaped);

    expect(emails).toHaveLength(1);
    expect(emails[0].body).toContain("From the beginning.");
    expect(emails[0].body).not.toContain(">From");
  });
  it("drops a message with no Message-ID and reports it", async () => {
    const withMissing = [
      "From alice@example.com Mon Jan 03 09:12:00 2022",
      "Message-ID: <keep@example.com>",
      "From: Alice <alice@example.com>",
      "Subject: Keep",
      "Date: Mon, 3 Jan 2022 09:12:00 -0500",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      "Kept body.",
      "",
      "From nobody@example.com Tue Feb 01 10:00:00 2022",
      "From: Nobody <nobody@example.com>",
      "Subject: No id",
      "Date: Tue, 1 Feb 2022 10:00:00 -0500",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      "Dropped body.",
    ].join("\n");

    const { emails, errors } = await parseMbox(withMissing);

    expect(emails.map((email) => email.messageId)).toEqual(["<keep@example.com>"]);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toBe("missing-message-id");
    expect(errors[0].snippet).toContain("Dropped body");
  });
  it("records parse-failed and continues when a message fails to parse", async () => {
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

    const { emails, errors } = await parseMbox(archive);

    expect(emails.map((email) => email.messageId)).toEqual(["<ok@example.com>"]);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toBe("parse-failed");
    expect(errors[0].detail).toBe("kaboom");
  });
  it("parses the full fixture archive and reports the message with no Message-ID", async () => {
    const contents = await readFile(
      new URL("./__fixtures__/sample.mbox", import.meta.url),
      "utf8"
    );

    const { emails, errors } = await parseMbox(contents);

    expect(emails.map((email) => email.messageId)).toEqual([
      "<invoice-001@example.com>",
      "<receipt-002@example.com>",
      "<escaped-004@example.com>",
      "<broken-005@example.com>",
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toBe("missing-message-id");
    expect(emails.length + errors.length).toBe(5);
  });
});
