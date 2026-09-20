import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { classifyEmail } from "./classify.ts";
import type { ParsedEmail } from "./types.ts";

const FAKE_RESULT = {
  model: "jev-test",
  answers: {
    category: {
      type: "choice",
      choice: "work",
      confidence: 0.9,
      probabilities: { personal: 0.05, work: 0.9, other: 0.05 },
    },
  },
  usage: { input_tokens: 10, output_tokens: 5 },
};

const EMAIL: ParsedEmail = {
  messageId: "<invoice-001@example.com>",
  from: "Billing <billing@example.com>",
  date: "Mon, 3 Jan 2022 09:12:00 -0500",
  dateParsed: new Date("2022-01-03T14:12:00.000Z"),
  subject: "Invoice for March",
  body: "Total due: $42.00",
  htmlBody: null,
  raw: "",
};

function makeClient(fakeFetch: (input: string, init?: RequestInit) => Promise<Response>) {
  return new TypeSafeClient({
    apiKey: "test",
    baseURL: "https://api.test",
    fetch: fakeFetch,
  });
}

describe("classifyEmail", () => {
  it("sends one request with the caller's questions and returns the full result", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fakeFetch = async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(FAKE_RESULT), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = makeClient(fakeFetch);
    const questions = {
      category: choice("What kind of email is this?", {
        personal: null,
        work: null,
        other: null,
      }),
    };

    const result = await classifyEmail({ client, email: EMAIL, questions });

    expect(calls).toHaveLength(1);
    expect(result.id).toBe("<invoice-001@example.com>");
    expect(result.email).toBe(EMAIL);
    expect(result.result).toEqual(FAKE_RESULT);
    expect(calls[0].body.model).toBeDefined();
    expect(calls[0].body.state).toMatchObject({
      from: EMAIL.from,
      date: EMAIL.date,
      subject: EMAIL.subject,
      body: EMAIL.body,
    });
    expect((calls[0].body.questions as Record<string, { type: string }>).category.type).toBe(
      "choice"
    );
  });

  it("does not mutate the email", async () => {
    const before = structuredClone(EMAIL);
    const client = makeClient(async () =>
      new Response(JSON.stringify(FAKE_RESULT), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await classifyEmail({
      client,
      email: EMAIL,
      questions: { category: choice("What kind of email is this?", { work: null, other: null }) },
    });

    expect(EMAIL).toEqual(before);
  });
});
