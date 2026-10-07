import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ParsedEmail, Question } from "../types.ts";
import { Classifier } from "./base.ts";
import { createClassifier } from "./index.ts";
import {
  DEFAULT_BASE_URL,
  DEFAULT_BODY_MAX_CHARS,
  MAX_CHOICE_CRITERIA,
  ONLY_OPTION,
  OllamaClassifier,
} from "./ollama.ts";
import type { EmailQuestions } from "./jev.ts";

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

/** The classifier sends through global fetch, so stubs go there. */
function stubFetch(record: Array<{ input: unknown; body: Record<string, unknown> }> = []) {
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    record.push({ input, body: JSON.parse(init?.body as string) });
    return okResponse(RAW_RESULT);
  });
  return record;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Native questions translated from the fake fixture. */
function nativeQuestions(): EmailQuestions {
  return new OllamaClassifier({ model: "test-model" }).translateQuestions(QUESTIONS);
}

describe("OllamaClassifier", () => {
  it("is a Classifier, with its CLASSIFIER name", () => {
    const ollama = new OllamaClassifier({ model: "test-model" });

    expect(ollama).toBeInstanceOf(Classifier);
    expect(ollama.name).toBe("ollama");
  });

  it("sends the built questions in one request to the local server", async () => {
    const calls = stubFetch();
    const ollama = new OllamaClassifier({ model: "test-model" });

    const result = await ollama.classify({ email: EMAIL });

    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe(`${DEFAULT_BASE_URL}/v1/systemone`);
    expect(calls[0].body.model).toBe("test-model");
    expect(result.id).toBe(EMAIL.messageId);
    expect(result.email).toBe(EMAIL);
    expect(result.truncated).toBe(false);
    expect(Object.keys(calls[0].body.questions as object).sort()).toEqual([
      "category",
      "free_trial_auto_converts",
      "involves_free_trial",
      "related_to_physical_goods",
      "related_to_services",
      "related_to_subscription",
      "sender_email",
      "sender_name",
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

  it("honors base URL and model overrides from the constructor", async () => {
    const calls = stubFetch();
    const ollama = new OllamaClassifier({
      baseURL: "http://localhost:9999/",
      model: "test-model",
    });

    await ollama.classify({ email: EMAIL });

    expect(calls[0].input).toBe("http://localhost:9999/v1/systemone");
    expect(calls[0].body.model).toBe("test-model");
  });

  it("wires OLLAMA_MODEL and OLLAMA_BASE_URL from the environment", async () => {
    const calls = stubFetch();
    const classifier = createClassifier({
      CLASSIFIER: "ollama",
      OLLAMA_BASE_URL: " http://192.168.1.50:11434 ",
      OLLAMA_MODEL: " custom-model ",
    });
    expect(classifier).toBeInstanceOf(OllamaClassifier);

    await classifier?.classify({ email: EMAIL });

    expect(calls[0].input).toBe("http://192.168.1.50:11434/v1/systemone");
    expect(calls[0].body.model).toBe("custom-model");
  });

  it("does not mutate the email", async () => {
    const before = structuredClone(EMAIL);
    stubFetch();
    const ollama = new OllamaClassifier({ model: "test-model" });

    await ollama.classify({ email: EMAIL });

    expect(EMAIL).toEqual(before);
  });

  it("truncates a body over the default cap before sending it", async () => {
    const calls = stubFetch();
    const longBody = "word ".repeat(50_000);
    const email = { ...EMAIL, body: longBody };
    const ollama = new OllamaClassifier({ model: "test-model" });

    const result = await ollama.classify({ email });

    const stateBody = (calls[0].body.state as { body: string }).body;
    expect(result.truncated).toBe(true);
    expect(stateBody.length).toBeLessThan(longBody.length);
    expect(stateBody.length).toBeLessThanOrEqual(DEFAULT_BODY_MAX_CHARS + 100);
    expect(stateBody).toContain("truncated");
  });

  it("truncates with a constructor bodyMaxChars override", async () => {
    const calls = stubFetch();
    const ollama = new OllamaClassifier({ model: "test-model", bodyMaxChars: 1000 });
    const email = { ...EMAIL, body: "word ".repeat(300) };

    const result = await ollama.classify({ email });

    const stateBody = (calls[0].body.state as { body: string }).body;
    expect(result.truncated).toBe(true);
    expect(stateBody.length).toBeLessThanOrEqual(1100);
  });

  it("wires OLLAMA_BODY_MAX_CHARS through the factory", async () => {
    stubFetch();
    const classifier = createClassifier({
      CLASSIFIER: "ollama",
      OLLAMA_MODEL: "clef-flash",
      OLLAMA_BODY_MAX_CHARS: "1000",
    });
    const email = { ...EMAIL, body: "word ".repeat(300) };

    const result = await classifier?.classify({ email });

    expect(result?.truncated).toBe(true);
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

  it("caps choice criteria at the endpoint's 2–26 window, keeping head and fallback", () => {
    const native = new OllamaClassifier({ model: "test-model" }).translateQuestions([
      {
        kind: "select",
        name: "sender_name",
        question: "Who sent this?",
        options: [
          ...Array.from({ length: 30 }, (_, i) => ({ value: `opt${i}` })),
          { value: "none", description: "Nothing matches." },
        ],
      },
    ]);

    const name = native["sender_name"];
    if (name.type !== "choice") throw new Error("expected choice");
    const keys = Object.keys(name.criteria);
    expect(keys).toHaveLength(MAX_CHOICE_CRITERIA);
    expect(keys.at(0)).toBe("opt0");
    expect(keys.at(-2)).toBe("opt24");
    expect(keys.at(-1)).toBe("none");
    expect(keys).not.toContain("opt25");
  });

  it("pads a single-option choice so either answer maps back to its value", () => {
    const ollama = new OllamaClassifier({ model: "test-model" });
    const native = ollama.translateQuestions([
      {
        kind: "select",
        name: "sender_email",
        question: "What is the sender's email?",
        options: [{ value: "none", description: "No candidate matches." }],
      },
    ]);

    const email = native["sender_email"];
    if (email.type !== "choice") throw new Error("expected choice");
    expect(Object.keys(email.criteria)).toEqual(["none", `${ONLY_OPTION}none`]);
    const [answer] = ollama.translateAnswers({
      model: "test-model",
      answers: {
        sender_email: { type: "choice", choice: `${ONLY_OPTION}none`, confidence: 0.4 },
      },
    } as unknown as Parameters<typeof ollama.translateAnswers>[0]);
    expect(answer).toEqual({
      name: "sender_email",
      kind: "select",
      value: "none",
      confidence: 0.4,
    });
  });
});

describe("translateAnswers", () => {
  it("converts the Ollama response into generic answers", () => {
    const ollama = new OllamaClassifier({ model: "test-model" });

    const answers = ollama.translateAnswers(
      RAW_RESULT as unknown as Parameters<typeof ollama.translateAnswers>[0],
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
