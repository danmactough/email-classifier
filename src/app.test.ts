import { describe, expect, it } from "vitest";
import { isLiveEnabled, shouldClassify } from "./app.ts";
import type { ParsedEmail } from "./types.ts";

function email(overrides: Partial<ParsedEmail>): ParsedEmail {
  return {
    messageId: "<x@example.com>",
    from: "",
    date: "",
    dateParsed: null,
    subject: "",
    body: "",
    htmlBody: null,
    raw: "",
    ...overrides,
  };
}

describe("shouldClassify", () => {
  it("matches the FILTER regex on any field and nothing else", () => {
    expect(
      shouldClassify(email({ from: "Invoice Bot <invoice@example.com>" }))
    ).toBe(true);
    expect(shouldClassify(email({ subject: "Your receipt" }))).toBe(true);
    expect(shouldClassify(email({ body: "Attached is the invoice." }))).toBe(true);
    expect(
      shouldClassify(email({ date: "Mon, 3 Jan 2022 09:12:00 -0500" }))
    ).toBe(false);
    expect(shouldClassify(email({ subject: "Hello", body: "Just saying hi" }))).toBe(
      false
    );
  });

  it("does not mutate the email", () => {
    const input = email({ subject: "Your receipt" });
    const before = structuredClone(input);

    shouldClassify(input);

    expect(input).toEqual(before);
  });
});

describe("isLiveEnabled", () => {
  it("is off unless JEV_LIVE is exactly 1", () => {
    expect(isLiveEnabled({})).toBe(false);
    expect(isLiveEnabled({ JEV_LIVE: "0" })).toBe(false);
    expect(isLiveEnabled({ JEV_LIVE: "" })).toBe(false);
    expect(isLiveEnabled({ JEV_LIVE: "1" })).toBe(true);
  });
});
