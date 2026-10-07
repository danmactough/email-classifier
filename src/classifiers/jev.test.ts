import { TypeSafeClient } from "@typesafe-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ParsedEmail, Question } from "../types.ts";
import { Classifier } from "./base.ts";
import { BODY_MAX_CHARS, JevClassifier, classifyEmail, type EmailQuestions } from "./jev.ts";

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

const RAW_RESULT = {
  model: "test-model",
  answers: {
    is_urgent: { type: "noul", noul: 0.97 },
    involves_refund: { type: "noul", noul: 0.3 },
    sentiment: {
      type: "score",
      score: 1.7,
      confidence: 0.8,
      legend: { 0: "negative", 1: "neutral", 2: "positive" },
      probabilities: {},
    },
    topic: {
      type: "choice",
      choice: "billing",
      confidence: 0.9,
      probabilities: { billing: 0.9, none: 0.1 },
    },
  },
  usage: { input_tokens: 10, output_tokens: 5 },
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

/** Both the classifier and classifyEmail send through global fetch, so stubs go there. */
function stubFetch(record: Array<{ body: Record<string, unknown> }> = []) {
  vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
    record.push({ body: JSON.parse(init?.body as string) });
    return okResponse(RAW_RESULT);
  });
  return record;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Native System One questions translated from the fake fixture. */
function nativeQuestions(): EmailQuestions {
  return new JevClassifier({ apiKey: "test" }).translateQuestions(QUESTIONS);
}

describe("classifyEmail", () => {
  it("sends the given questions in one request with raw headers in state", async () => {
    const calls = stubFetch();
    const client = new TypeSafeClient({ apiKey: "test" });

    const result = await classifyEmail({
      client,
      email: EMAIL,
      questions: nativeQuestions(),
      maxBodyChars: BODY_MAX_CHARS,
    });

    expect(calls).toHaveLength(1);
    expect(result.id).toBe("<invoice-001@example.com>");
    expect(result.email).toBe(EMAIL);
    expect(result.truncated).toBe(false);
    expect(result.result).toEqual(RAW_RESULT);
    expect(Object.keys(calls[0].body.questions as object).sort()).toEqual([
      "involves_refund",
      "is_urgent",
      "sentiment",
      "topic",
    ]);
    expect(calls[0].body.state).toMatchObject({
      from: EMAIL.from,
      date: EMAIL.date,
      subject: EMAIL.subject,
      body: EMAIL.body,
    });
    expect((calls[0].body.state as { headers: string }).headers).toBe(
      [
        "From: Billing <billing@example.com>",
        "Reply-To: help@example.com",
        "Subject: Invoice for March",
      ].join("\n"),
    );
  });

  it("does not mutate the email", async () => {
    const before = structuredClone(EMAIL);
    stubFetch();
    const client = new TypeSafeClient({ apiKey: "test" });

    await classifyEmail({
      client,
      email: EMAIL,
      questions: nativeQuestions(),
      maxBodyChars: BODY_MAX_CHARS,
    });

    expect(EMAIL).toEqual(before);
  });

  it("truncates a body over the cap before sending it", async () => {
    const calls = stubFetch();
    const client = new TypeSafeClient({ apiKey: "test" });
    const longBody = "word ".repeat(2000);
    const email = { ...EMAIL, body: longBody };

    const result = await classifyEmail({
      client,
      email,
      questions: nativeQuestions(),
      maxBodyChars: 1000,
    });

    const stateBody = (calls[0].body.state as { body: string }).body;
    expect(result.truncated).toBe(true);
    expect(stateBody.length).toBeLessThan(longBody.length);
    expect(stateBody).toContain("truncated");
  });
});

describe("JevClassifier", () => {
  it("is a Classifier, with its CLASSIFIER name", () => {
    const jev = new JevClassifier({ apiKey: "test" });

    expect(jev).toBeInstanceOf(Classifier);
    expect(jev.name).toBe("jev");
  });

  it("classifies with the built questions and returns generic answers", async () => {
    const calls = stubFetch();
    // The cap is the fixed BODY_MAX_CHARS, so the body must exceed 100k chars.
    const longBody = "word ".repeat(25000);
    const jev = new JevClassifier({ apiKey: "test" });

    const result = await jev.classify({ email: { ...EMAIL, body: longBody } });

    expect(calls).toHaveLength(1);
    expect(result.id).toBe(EMAIL.messageId);
    expect(result.truncated).toBe(true);
    const wireQuestions = Object.values(
      calls[0].body.questions as Record<string, { type: string; criteria?: object }>,
    );
    expect(wireQuestions.length).toBeGreaterThan(0);
    expect(wireQuestions.every((q) => q.type === "noul" || q.type === "choice")).toBe(true);
    expect(calls[0].body.state).toMatchObject({
      body: expect.stringContaining("truncated"),
    });
    expect(result.answers.find((a) => a.name === "is_urgent")).toEqual({
      name: "is_urgent",
      kind: "probability",
      value: 0.97,
    });
    expect(result.answers.find((a) => a.name === "sentiment")).toEqual({
      name: "sentiment",
      kind: "score",
      value: 1.7,
      confidence: 0.8,
      max: 2,
    });
  });

  it("maps generic binary questions onto noul, criteria preserved", () => {
    const native = nativeQuestions();

    expect(native["is_urgent"].type).toBe("noul");
    expect(native["is_urgent"].criteria ?? null).toBeNull();
    const refund = native["involves_refund"];
    if (
      refund.type !== "noul" ||
      !refund.criteria ||
      typeof refund.criteria.true !== "string" ||
      typeof refund.criteria.false !== "string"
    ) {
      throw new Error("expected noul criteria");
    }
    expect(refund.criteria.true).toContain("Mentions money back");
    expect(refund.criteria.false).toContain("No refund mentioned");
    expect(Object.keys(native).sort()).toEqual([
      "involves_refund",
      "is_urgent",
      "sentiment",
      "topic",
    ]);
  });

  it("maps score rubrics onto score questions", () => {
    const native = nativeQuestions();

    const sentiment = native["sentiment"];
    if (sentiment.type !== "score") throw new Error("expected score");
    expect(sentiment.criteria).toHaveLength(3);
    expect(sentiment.criteria.at(0)).toBe("Complaints or frustration.");
    expect(sentiment.criteria.at(-1)).toBe("Praise or satisfaction.");
  });

  it("maps select options to choice criteria with none kept last", () => {
    const native = nativeQuestions();

    const topic = native["topic"];
    if (topic.type !== "choice") throw new Error("expected choice");
    const keys = Object.keys(topic.criteria);
    expect(keys).toEqual(["billing", "shipping", "none"]);
    expect(topic.criteria["billing"]).toBe("Invoices and payments.");
    expect(topic.criteria["shipping"] ?? null).toBeNull();
    expect(topic.criteria["none"]).toBe("Nothing here matches.");
  });
});

describe("translateAnswers", () => {
  it("converts the System One response into generic answers", () => {
    const jev = new JevClassifier({ apiKey: "test" });

    const answers = jev.translateAnswers(
      RAW_RESULT as unknown as Parameters<typeof jev.translateAnswers>[0],
    );

    expect(answers).toEqual([
      { name: "is_urgent", kind: "probability", value: 0.97 },
      { name: "involves_refund", kind: "probability", value: 0.3 },
      {
        name: "sentiment",
        kind: "score",
        value: 1.7,
        confidence: 0.8,
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
});
