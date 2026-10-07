import type { TypeSafeClient } from "@typesafe-ai/sdk";
import type { EmailQuestions } from "./questions.ts";
import type { ClassifiedEmail, ParsedEmail } from "./types.ts";

// The API caps `state` plus the longest question at 32k tokens, and we cannot
// count tokens without a tokenizer. Plain text runs about 4 chars per token, so
// 100k chars leaves room for the header block and the candidate options.
export const DEFAULT_BODY_MAX_CHARS = 100_000;

/** Trim a body to a character cap at a nearby boundary, marking the omission. */
export function truncateBody(
  body: string,
  maxChars: number
): { body: string; truncated: boolean } {
  if (body.length <= maxChars) return { body, truncated: false };
  const cut = body.slice(0, maxChars);
  const boundary = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
  const kept = boundary > maxChars * 0.5 ? cut.slice(0, boundary) : cut;
  return {
    body: `${kept}\n[…truncated: ${body.length - kept.length} characters omitted…]`,
    truncated: true,
  };
}

/** The body cap from the environment, falling back to the default. */
export function resolveMaxBodyChars(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.BODY_MAX_CHARS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BODY_MAX_CHARS;
}

/** The raw header block, everything before the first blank line of the message. */
function headerBlock(raw: string): string {
  const end = raw.indexOf("\n\n");
  return end === -1 ? raw : raw.slice(0, end);
}

/**
 * Shape the email into the classifier's `state` inline, ask the caller-supplied questions,
 * and return everything the classifier sent back.
 */
export async function classifyEmail(options: {
  client: TypeSafeClient;
  email: ParsedEmail;
  questions: EmailQuestions;
  maxBodyChars: number;
}): Promise<ClassifiedEmail> {
  const { client, email, questions, maxBodyChars } = options;
  const { body, truncated } = truncateBody(email.body, maxBodyChars);
  const state = {
    from: email.from,
    date: email.date,
    subject: email.subject,
    body,
    headers: headerBlock(email.raw),
  };
  const result = await client.systemOne({ state, questions });
  return { id: email.messageId, email, result, truncated };
}
