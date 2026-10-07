import { TypeSafeClient } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  classifyEmail,
  DEFAULT_BODY_MAX_CHARS,
  truncateBody,
} from "./classify.ts";
import { buildQuestions } from "./questions.ts";
import type { ParsedEmail } from "./types.ts";

const FAKE_RESULT = {
  model: "jev-test",
  answers: {
    related_to_subscription: { type: "noul", noul: 0.97 },
    related_to_physical_goods: { type: "noul", noul: 0.02 },
    related_to_services: { type: "noul", noul: 0.95 },
    category: {
      type: "choice",
      choice: "trial_ending",
      confidence: 0.9,
      probabilities: { trial_ending: 0.9, other: 0.1 },
    },
    sender_name: {
      type: "choice",
      choice: "Acme Cloud Team",
      confidence: 0.9,
      probabilities: { "Acme Cloud Team": 0.9, none: 0.1 },
    },
    sender_email: {
      type: "choice",
      choice: "help@shop.example.com",
      confidence: 0.9,
      probabilities: { "help@shop.example.com": 0.9, none: 0.1 },
    },
  },
  usage: { input_tokens: 10, output_tokens: 5 },
};

const EMAIL: ParsedEmail = {
  messageId: "<invoice-001@example.com>",
  from: "Billing <billing@example.com>",
  from_parsed: { name: "Billing" },
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

function makeClient(
  fakeFetch: (input: string, init?: RequestInit) => Promise<Response>
) {
  return new TypeSafeClient({
    apiKey: "test",
    baseURL: "https://api.test",
    fetch: fakeFetch,
  });
}

describe("classifyEmail", () => {
  it("sends all six questions in one request with raw headers in state", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fakeFetch = async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(FAKE_RESULT), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = makeClient(fakeFetch);
    const questions = buildQuestions({ email: EMAIL });

    const result = await classifyEmail({
      client,
      email: EMAIL,
      questions,
      maxBodyChars: DEFAULT_BODY_MAX_CHARS,
    });

    expect(calls).toHaveLength(1);
    expect(result.id).toBe("<invoice-001@example.com>");
    expect(result.email).toBe(EMAIL);
    expect(result.truncated).toBe(false);
    expect(result.result).toEqual(FAKE_RESULT);
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
      ].join("\n")
    );
    expect(result.result.answers.category.choice).toBe("trial_ending");
  });

  it("does not mutate the email", async () => {
    const before = structuredClone(EMAIL);
    const client = makeClient(
      async () =>
        new Response(JSON.stringify(FAKE_RESULT), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );

    await classifyEmail({
      client,
      email: EMAIL,
      questions: buildQuestions({ email: EMAIL }),
      maxBodyChars: DEFAULT_BODY_MAX_CHARS,
    });

    expect(EMAIL).toEqual(before);
  });

  it("truncates a body over the cap before sending it", async () => {
    const calls: Array<{ body: Record<string, unknown> }> = [];
    const client = makeClient(async (input: string, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(FAKE_RESULT), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const longBody = "word ".repeat(2000);
    const email = { ...EMAIL, body: longBody };

    const result = await classifyEmail({
      client,
      email,
      questions: buildQuestions({ email }),
      maxBodyChars: 1000,
    });

    const stateBody = (calls[0].body.state as { body: string }).body;
    expect(result.truncated).toBe(true);
    expect(stateBody.length).toBeLessThan(longBody.length);
    expect(stateBody).toContain("truncated");
  });
});

describe("truncateBody", () => {
  it("leaves a body at or under the cap untouched", () => {
    expect(truncateBody("hello", 100)).toEqual({ body: "hello", truncated: false });
    expect(truncateBody("hello", 5)).toEqual({ body: "hello", truncated: false });
  });

  it("cuts at a boundary and notes how much was omitted", () => {
    const long = `${"a".repeat(50)}\n${"b".repeat(50)}`;

    const { body, truncated } = truncateBody(long, 60);

    expect(truncated).toBe(true);
    expect(body).toContain("truncated");
    expect(body).toContain("omitted");
    expect(body.length).toBeLessThan(long.length);
  });
});
