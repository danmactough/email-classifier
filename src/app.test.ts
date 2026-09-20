import { describe, expect, it } from "vitest";
import { isLiveEnabled, selectEmails } from "./app.ts";
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

describe("selectEmails", () => {
  it("includes only emails matching the criteria, by identity", () => {
    const emails = [
      email({ messageId: "<from>", from: "Invoice Bot <invoice@example.com>" }),
      email({ messageId: "<subject>", subject: "Your receipt" }),
      email({ messageId: "<body>", body: "Attached is the invoice." }),
      email({ messageId: "<date>", date: "Mon, 3 Jan 2022 09:12:00 -0500" }),
      email({ messageId: "<none>", subject: "Hello", body: "Just saying hi" }),
    ];

    const selected = selectEmails(emails);

    expect(selected.map((item) => item.messageId)).toEqual([
      "<from>",
      "<subject>",
      "<body>",
    ]);
    expect(selected[0]).toBe(emails[0]);
    expect(emails).toHaveLength(5);
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
