import { describe, expect, it } from "vitest";
import { CATEGORIES, buildQuestions } from "./questions.ts";
import type { ParsedEmail, Question } from "./types.ts";

function email(overrides: Partial<ParsedEmail>): ParsedEmail {
  return {
    messageId: "<x@example.com>",
    from: "",
    fromParsed: { name: "" },
    date: "",
    dateParsed: null,
    subject: "",
    body: "",
    htmlBody: null,
    raw: "",
    ...overrides,
  };
}

function question(questions: Question[], name: string): Question {
  const found = questions.find((q) => q.name === name);
  if (!found) throw new Error(`missing question ${name}`);
  return found;
}

const SELECTS = [
  ["category", "select"],
  ["free_trial_auto_converts", "binary"],
  ["involves_free_trial", "binary"],
  ["related_to_physical_goods", "binary"],
  ["related_to_services", "binary"],
  ["related_to_subscription", "binary"],
  ["sender_email", "select"],
  ["sender_name", "select"],
] as const;

describe("buildQuestions", () => {
  it("returns the eight questions with candidates as the sender options", () => {
    const questions = buildQuestions({
      email: email({
        from: "Shop Support <no-reply@mailer.shop.example.com>",
        fromParsed: { name: "Shop Support" },
        body: "Hi Dan,\nThanks,\nAcme Cloud Team\n",
        raw: [
          "From: Shop Support <no-reply@mailer.shop.example.com>",
          "Reply-To: help@shop.example.com",
          "",
          "body",
        ].join("\n"),
      }),
    });

    expect(
      questions.map((q) => [q.name, q.kind] as const).sort()
    ).toEqual(SELECTS);

    const involves = question(questions, "involves_free_trial");
    const autoConverts = question(questions, "free_trial_auto_converts");
    const category = question(questions, "category") as Extract<
      Question,
      { kind: "select" }
    >;
    const senderName = question(questions, "sender_name") as Extract<
      Question,
      { kind: "select" }
    >;
    const senderEmail = question(questions, "sender_email") as Extract<
      Question,
      { kind: "select" }
    >;

    expect(involves.kind === "binary" ? involves.criteria?.true : null).toBeTruthy();
    expect(autoConverts.kind === "binary" ? autoConverts.criteria?.false : null).toBeTruthy();
    expect(category.options.map((option) => option.value)).toEqual([...CATEGORIES]);
    const nameValues = senderName.options.map((option) => option.value);
    expect(nameValues).toContain("Shop Support");
    expect(nameValues).toContain("Acme Cloud Team");
    expect(nameValues.at(-1)).toBe("none");
    expect(senderName.options.at(-1)).toEqual({
      value: "none",
      description: "No candidate is the sender's name.",
    });
    expect(senderEmail.options.map((option) => option.value)).toEqual(
      expect.arrayContaining([
        "no-reply@mailer.shop.example.com",
        "help@shop.example.com",
        "none",
      ])
    );
  });

  it("describes every category option with non-empty text", () => {
    const questions = buildQuestions({ email: email({}) });
    const category = question(questions, "category") as Extract<
      Question,
      { kind: "select" }
    >;

    for (const option of category.options) {
      expect(typeof option.description).toBe("string");
      expect((option.description as string).trim().length).toBeGreaterThan(0);
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

    const senderName = question(questions, "sender_name") as Extract<
      Question,
      { kind: "select" }
    >;
    expect(senderName.options.map((option) => option.value)).toContain(
      "Acme Cloud Team"
    );
  });
});