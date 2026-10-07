import { describe, expect, it } from "vitest";
import { buildQuestions, CATEGORIES } from "./questions.ts";
import type { ParsedEmail } from "./types.ts";

function email(overrides: Partial<ParsedEmail>): ParsedEmail {
  return {
    messageId: "<x@example.com>",
    from: "",
    from_parsed: { name: "" },
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
  it("returns the eight questions with candidates as the sender options", () => {
    const questions = buildQuestions({
      email: email({
        from: "Shop Support <no-reply@mailer.shop.example.com>",
        from_parsed: { name: "Shop Support" },
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
      "free_trial_auto_converts",
      "involves_free_trial",
      "related_to_physical_goods",
      "related_to_services",
      "related_to_subscription",
      "sender_email",
      "sender_name",
    ]);
    expect(questions.related_to_subscription.type).toBe("noul");
    expect(questions.related_to_physical_goods.type).toBe("noul");
    expect(questions.related_to_services.type).toBe("noul");
    expect(questions.involves_free_trial.type).toBe("noul");
    expect(questions.involves_free_trial.criteria?.true).toBeTruthy();
    expect(questions.free_trial_auto_converts.type).toBe("noul");
    expect(questions.free_trial_auto_converts.criteria?.false).toBeTruthy();
    expect(Object.keys(questions.category.criteria)).toEqual([...CATEGORIES]);
    expect(Object.keys(questions.category.criteria)).toEqual(
      expect.arrayContaining(["trial_started", "trial_ending", "trial_converted"])
    );
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

  it("keeps the signature name when a name-dense body exceeds the cap", () => {
    const filler = Array.from(
      { length: 120 },
      (_, i) =>
        `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(
          97 + Math.floor(i / 26)
        )}x`
    );
    const questions = buildQuestions({
      email: email({
        body: [...filler, "Thanks,", "Acme Cloud Team"].join("\n"),
      }),
    });

    expect(Object.keys(questions.sender_name.criteria)).toContain(
      "Acme Cloud Team"
    );
  });
});
