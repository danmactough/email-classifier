import {
  choice,
  noul,
  score,
  TypeSafeClient,
  type EntryType,
  type Question as SystemOneQuestion,
  type SystemOneResult,
} from "@typesafe-ai/sdk";
import { headerBlock, truncateBody } from "../helpers.ts";
import { buildQuestions } from "../questions.ts";
import type { Answer, ClassifiedEmail, ParsedEmail, Question } from "../types.ts";
import { Classifier } from "./base.ts";

// The API caps `state` plus the longest question at 32k tokens, and we cannot
// count tokens without a tokenizer. Plain text runs about 4 chars per token, so
// 100k chars leaves room for the header block and the candidate options.
export const BODY_MAX_CHARS = 100_000;

/** TypeSafe System One classifier ("jev"). */
export class JevClassifier extends Classifier {
  readonly name = "jev";
  readonly #client: TypeSafeClient;

  constructor(options: { apiKey: string }) {
    super();
    this.#client = new TypeSafeClient({ apiKey: options.apiKey });
  }

  /** Map the generic questions onto System One's noul/score/choice wire format. */
  translateQuestions(questions: Question[]): EmailQuestions {
    const map: EmailQuestions = {};
    for (const question of questions) {
      if (question.kind === "binary") {
        map[question.name] = noul(question.question, question.criteria);
      } else if (question.kind === "score") {
        // The rubric tuple needs a minimum length the builder cannot infer.
        map[question.name] = score(
          question.question,
          question.levels.map((level) => level.description) as [
            EntryType,
            EntryType,
            ...EntryType[],
          ],
        );
      } else {
        const criteria: Record<string, string | null> = {};
        for (const option of question.options) {
          criteria[option.value] = option.description ?? null;
        }
        map[question.name] = choice(question.question, criteria);
      }
    }
    return map;
  }

  /** System One's noul/score/choice responses become the generic answers. */
  translateAnswers(raw: SystemOneResult<EmailQuestions>): Answer[] {
    return Object.entries(raw.answers).map(([name, answer]) => {
      if (answer.type === "noul") {
        return { name, kind: "probability", value: answer.noul };
      }
      if (answer.type === "score") {
        return {
          name,
          kind: "score",
          value: answer.score,
          confidence: answer.confidence,
          max: Math.max(0, ...Object.keys(answer.legend).map(Number)),
        };
      }
      return {
        name,
        kind: "select",
        value: answer.choice,
        confidence: answer.confidence,
      };
    });
  }

  async classify(options: { email: ParsedEmail }): Promise<ClassifiedEmail> {
    const email = options.email;
    const result = await classifyEmail({
      client: this.#client,
      email,
      questions: this.translateQuestions(buildQuestions({ email })),
      maxBodyChars: BODY_MAX_CHARS,
    });
    return {
      id: email.messageId,
      email,
      answers: this.translateAnswers(result.result),
      truncated: result.truncated,
    };
  }
}

/**
 * System One sends questions as a name-keyed object; its answers echo those
 * names. The question set itself is defined generically in `questions.ts`.
 */
export type EmailQuestions = Record<string, SystemOneQuestion>;

/**
 * Shape the email into the classifier's `state` inline, ask the caller-supplied questions,
 * and return everything the classifier sent back.
 */
export async function classifyEmail(options: {
  client: TypeSafeClient;
  email: ParsedEmail;
  questions: EmailQuestions;
  maxBodyChars: number;
}): Promise<{
  id: string;
  email: ParsedEmail;
  result: SystemOneResult<EmailQuestions>;
  truncated: boolean;
}> {
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
