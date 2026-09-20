import type { TypeSafeClient } from "@typesafe-ai/sdk";
import type { EmailQuestions } from "./questions.ts";
import type { ClassifiedEmail, ParsedEmail } from "./types.ts";

/** The raw header block, everything before the first blank line of the message. */
function headerBlock(raw: string): string {
  const end = raw.indexOf("\n\n");
  return end === -1 ? raw : raw.slice(0, end);
}

/**
 * Shape the email into Jev `state` inline, ask the caller-supplied questions,
 * and return everything Jev sent back.
 */
export async function classifyEmail(options: {
  client: TypeSafeClient;
  email: ParsedEmail;
  questions: EmailQuestions;
}): Promise<ClassifiedEmail> {
  const { client, email, questions } = options;
  const state = {
    from: email.from,
    date: email.date,
    subject: email.subject,
    body: email.body,
    headers: headerBlock(email.raw),
  };
  const result = await client.systemOne({ state, questions });
  return { id: email.messageId, email, result };
}
