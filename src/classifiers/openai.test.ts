import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParsedEmail, Question } from "../types.ts";
import { Classifier } from "./base.ts";
import { BODY_MAX_CHARS, OpenAIClassifier } from "./openai.ts";

// Classifier tests use fake questions and raw responses: they exercise the
// wire mappings for every generic kind, not the real question set (that is
// questions.ts's own concern).
const QUESTIONS: Question[] = [
  { kind: "binary", name: "is_urgent", question: "Is this urgent?" },
  {
    kind: "binary",
    name: "involves_refund",
    question: "Does this involve a refund?",
    criteria: {
      true: "Mentions money back.",
      false: "No refund mentioned.",
    },
  },
  {
    kind: "score",
    name: "sentiment",
    question: "How positive is the tone?",
    levels: [
      { label: "Negative", description: "Complaints or frustration." },
      { label: "Neutral", description: "Purely transactional." },
      { label: "Positive", description: "Praise or satisfaction." },
    ],
  },
  {
    kind: "select",
    name: "topic",
    question: "What is this email about?",
    options: [
      { value: "billing", description: "Invoices and payments." },
      { value: "shipping" },
      { value: "none", description: "Nothing here matches." },
    ],
  },
];

const RAW_DECISION = {
  model: "gpt-6-luna",
  answers: [
    { type: "predicate", name: "is_urgent", probability: 0.93 },
    { type: "refusal", name: "involves_refund" },
    {
      type: "score",
      name: "sentiment",
      score: 1.7,
      confidence: 0.7,
      probabilities: [
        { value: 0, label: "Negative", probability: 0.2 },
        { value: 1, label: "Neutral", probability: 0.5 },
        { value: 2, label: "Positive", probability: 0.3 },
      ],
    },
    {
      type: "choice",
      name: "topic",
      choice: "billing",
      confidence: 0.9,
      probabilities: [{ value: "billing", probability: 0.9 }],
    },
  ],
  usage: {
    input_tokens: 10,
    input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
    output_tokens: 0,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 10,
  },
};

const EMAIL: ParsedEmail = {
  messageId: "<invoice-001@example.com>",
  from: "Billing <billing@example.com>",
  fromParsed: { name: "Billing" },
  date: "Mon, 3 Jan 2022 09:12:00 -0500",
  dateParsed: new Date("2022-01-03T14:12:00.000Z"),
  subject: "Invoice for March",
  body: "Total due: $42.00",
  htmlBody: null,
  raw: [
    "From: Billing <billing@example.com>",
    "Reply-To: help@example.com",
    "Subject: Invoice for March",
    "",
    "Total due: $42.00",
  ].join("\n"),
};

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** The classifier builds its own client, so wire stubs go through global fetch. */
function stubFetch(record: Array<{ headers: Headers; body: Record<string, unknown> }> = []) {
  vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
    record.push({
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return okResponse(RAW_DECISION);
  });
  return record;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAIClassifier", () => {
  it("is a Classifier, with its CLASSIFIER name", () => {
    const openai = new OpenAIClassifier({ apiKey: "test" });

    expect(openai).toBeInstanceOf(Classifier);
    expect(openai.name).toBe("openai");
  });

  it("classifies with the built questions and returns generic answers", async () => {
    const calls = stubFetch();
    const openai = new OpenAIClassifier({ apiKey: "test" });

    const result = await openai.classify({ email: EMAIL });

    expect(calls).toHaveLength(1);
    expect(calls[0].headers.get("authorization")).toBe("Bearer test");
    const body = calls[0].body as {
      model: string;
      input: string;
      questions: Array<{ type: string; name: string; instructions: string }>;
    };
    expect(body.model).toBe("gpt-6-luna");
    expect(body.input).toContain(EMAIL.from);
    expect(body.input).toContain(EMAIL.subject);
    expect(body.input).toContain(EMAIL.body);
    expect(body.input).toContain("Reply-To: help@example.com");
    const wireQuestions = body.questions;
    expect(wireQuestions.length).toBeGreaterThan(0);
    expect(
      wireQuestions.every((q) => q.type === "predicate" || q.type === "choice")
    ).toBe(true);
    expect(result.answers).toEqual([
      { name: "is_urgent", kind: "probability", value: 0.93 },
      { name: "involves_refund", kind: "refusal" },
      {
        name: "sentiment",
        kind: "score",
        value: 1.7,
        confidence: 0.7,
        max: 2,
      },
      {
        name: "topic",
        kind: "select",
        value: "billing",
        confidence: 0.9,
      },
    ]);
  });

  it("maps generic binary questions onto predicates, criteria folded in", () => {
    const wire = new OpenAIClassifier({ apiKey: "test" }).translateQuestions(
      QUESTIONS
    );

    const urgent = wire.find((q) => q.name === "is_urgent");
    if (urgent?.type !== "predicate") throw new Error("expected predicate");
    expect(urgent.instructions).toBe("Is this urgent?");

    const refund = wire.find((q) => q.name === "involves_refund");
    if (refund?.type !== "predicate") throw new Error("expected predicate");
    expect(refund.instructions).toContain("It is true when: Mentions money back.");
    expect(refund.instructions).toContain("It is false when: No refund mentioned.");
  });

  it("maps score rubrics onto score questions", () => {
    const wire = new OpenAIClassifier({ apiKey: "test" }).translateQuestions(
      QUESTIONS
    );

    const sentiment = wire.find((q) => q.name === "sentiment");
    if (sentiment?.type !== "score") throw new Error("expected score");
    expect(sentiment.instructions).toBe("How positive is the tone?");
    expect(sentiment?.levels).toEqual([
      { label: "Negative", description: "Complaints or frustration." },
      { label: "Neutral", description: "Purely transactional." },
      { label: "Positive", description: "Praise or satisfaction." },
    ]);
  });

  it("maps select options to choices with descriptions, none kept last", () => {
    const wire = new OpenAIClassifier({ apiKey: "test" }).translateQuestions(
      QUESTIONS
    );

    const topic = wire.find((q) => q.name === "topic");
    if (topic?.type !== "choice") throw new Error("expected choice");
    expect(topic.choices).toEqual([
      { value: "billing", description: "Invoices and payments." },
      { value: "shipping" },
      { value: "none", description: "Nothing here matches." },
    ]);
  });

  it("truncates a body over the input cap before sending it", async () => {
    stubFetch();
    const openai = new OpenAIClassifier({ apiKey: "test" });
    const email = {
      ...EMAIL,
      body: "x".repeat(BODY_MAX_CHARS + 10),
    };

    const result = await openai.classify({ email });

    expect(result.truncated).toBe(true);
    expect(result.email.body.length).toBe(email.body.length);
  });

  it("does not mutate the email", async () => {
    const before = structuredClone(EMAIL);
    stubFetch();
    const openai = new OpenAIClassifier({ apiKey: "test" });

    await openai.classify({ email: EMAIL });

    expect(EMAIL).toEqual(before);
  });

  it("raises a failed HTTP status as an error", async () => {
    vi.stubGlobal("fetch", async () => new Response("rate limited", { status: 429 }));
    const openai = new OpenAIClassifier({ apiKey: "test" });

    await expect(openai.classify({ email: EMAIL })).rejects.toThrow("429");
  });
});