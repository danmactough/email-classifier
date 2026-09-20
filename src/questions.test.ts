import { describe, expect, it } from "vitest";
import { buildQuestions, CATEGORIES, findSenderCandidates } from "./questions.ts";
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

describe("buildQuestions", () => {
  it("returns the six questions with candidates as the sender options", () => {
    const questions = buildQuestions({
      email: email({
        from: "Shop Support <no-reply@mailer.shop.example.com>",
        body: "Hi Dan,\nThanks,\nAcme Cloud Team\n",
        raw: [
          "From: Shop Support <no-reply@mailer.shop.example.com>",
          "Reply-To: help@shop.example.com",
          "",
          "body",
        ].join("\n"),
      }),
    });

    expect(Object.keys(questions).sort()).toEqual([
      "category",
      "related_to_physical_goods",
      "related_to_services",
      "related_to_subscription",
      "sender_email",
      "sender_name",
    ]);
    expect(questions.related_to_subscription.type).toBe("noul");
    expect(questions.related_to_physical_goods.type).toBe("noul");
    expect(questions.related_to_services.type).toBe("noul");
    expect(Object.keys(questions.category.criteria)).toEqual([...CATEGORIES]);
    expect(Object.keys(questions.sender_name.criteria)).toContain("none");
    expect(Object.keys(questions.sender_name.criteria)).toContain("Shop Support");
    expect(Object.keys(questions.sender_name.criteria)).toContain("Acme Cloud Team");
    expect(Object.keys(questions.sender_email.criteria)).toEqual(
      expect.arrayContaining([
        "no-reply@mailer.shop.example.com",
        "help@shop.example.com",
        "none",
      ])
    );
  });

  it("describes every category option with non-empty text", () => {
    const questions = buildQuestions({ email: email({}) });

    for (const label of CATEGORIES) {
      const description = questions.category.criteria[label];
      expect(typeof description).toBe("string");
      expect((description as string).trim().length).toBeGreaterThan(0);
    }
  });
});

describe("findSenderCandidates", () => {
  it("over-finds deduped emails and signature names in first-seen order", () => {
    const message = email({
      from: "Shop Support <no-reply@mailer.shop.example.com>",
      body: [
        "Line one mentions Dan.",
        "Contact jordan.rivers@acme.com or support@shop.example.com.",
        "Thanks,",
        "Acme Cloud Team",
      ].join("\n"),
      raw: [
        "From: Shop Support <no-reply@mailer.shop.example.com>",
        "Reply-To: help@shop.example.com",
        "",
        "Contact jordan.rivers@acme.com or support@shop.example.com.",
      ].join("\n"),
    });

    const candidates = findSenderCandidates(message);

    expect(candidates.emails).toEqual([
      "no-reply@mailer.shop.example.com",
      "help@shop.example.com",
      "jordan.rivers@acme.com",
      "support@shop.example.com",
    ]);
    expect(candidates.names[0]).toBe("Shop Support");
    expect(candidates.names).toContain("Acme Cloud Team");
    expect(new Set(candidates.names).size).toBe(candidates.names.length);
    expect(new Set(candidates.emails).size).toBe(candidates.emails.length);
  });

  it("caps each list and never emits the none label", () => {
    const addresses = Array.from(
      { length: 150 },
      (_, index) => `user${index}@example.com`
    );
    const message = email({
      from: "A <a@example.com>",
      body: addresses.map((address) => `Contact ${address}.`).join("\n"),
      raw: ["From: A <a@example.com>", "", ...addresses].join("\n"),
    });

    const candidates = findSenderCandidates(message);

    expect(candidates.emails).toHaveLength(100);
    expect(candidates.emails).not.toContain("none");
    expect(candidates.names.length).toBeLessThanOrEqual(100);
    expect(candidates.names).not.toContain("none");
  });
});
