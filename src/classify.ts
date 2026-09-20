import type { Questions, TypeSafeClient } from "@typesafe-ai/sdk";
import type { ClassifiedEmail, ParsedEmail } from "./types.ts";

/**
 * Shape the email into Jev `state` inline, ask the caller-supplied questions,
 * and return everything Jev sent back.
 */
export async function classifyEmail(options: {
  client: TypeSafeClient;
  email: ParsedEmail;
  questions: Questions;
}): Promise<ClassifiedEmail> {
  const { client, email, questions } = options;
  const state = {
    from: email.from,
    date: email.date,
    subject: email.subject,
    body: email.body,
  };
  const result = await client.systemOne({ state, questions });
  return { id: email.messageId, email, result };
}
