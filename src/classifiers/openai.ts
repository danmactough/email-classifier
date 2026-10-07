import OpenAI from "openai";
import type { Decision, DecisionCreateParams } from "openai/resources/decisions";
import { headerBlock, truncateBody } from "../helpers.ts";
import { buildQuestions } from "../questions.ts";
import type { Answer, ClassifiedEmail, ParsedEmail, Question } from "../types.ts";
import { Classifier } from "./base.ts";

// The Decisions input text caps at 10,485,760 characters (per the API
// reference); the body is capped below that, leaving room for the header
// block and the other fields of the input.
export const BODY_MAX_CHARS = 10_000_000;

/** The Decisions API's only available model (public beta per the docs). */
const MODEL = "gpt-6-luna";

/** OpenAI Decisions classifier ("openai"). */
export class OpenAIClassifier extends Classifier {
  readonly name = "openai";
  readonly #client: OpenAI;

  constructor(options: { apiKey: string }) {
    super();
    this.#client = new OpenAI({ apiKey: options.apiKey });
  }

  /** Map the generic questions onto Decisions' predicate/choice/score wire format. */
  translateQuestions(questions: Question[]): DecisionCreateParams["questions"] {
    return questions.map((question) => {
      if (question.kind === "binary") {
        // Decisions predicates take a single instruction, so the binary
        // criteria are folded into the instruction text.
        const instructions = question.criteria
          ? `${question.question} It is true when: ${question.criteria.true} It is false when: ${question.criteria.false}`
          : question.question;
        return {
          type: "predicate" as const,
          name: question.name,
          instructions,
        };
      }
      if (question.kind === "score") {
        return {
          type: "score" as const,
          name: question.name,
          instructions: question.question,
          levels: question.levels.map((level) => ({
            label: level.label,
            description: level.description,
          })),
        };
      }
      return {
        type: "choice" as const,
        name: question.name,
        instructions: question.question,
        choices: question.options.map((option) =>
          option.description
            ? { value: option.value, description: option.description }
            : { value: option.value }
        ),
      };
    });
  }

  /** Decisions answers become probability/score/select/refusal answers. */
  translateAnswers(raw: Decision): Answer[] {
    return raw.answers.map((answer) => {
      const name = answer.name ?? "";
      if (answer.type === "predicate") {
        return { name, kind: "probability", value: answer.probability };
      }
      if (answer.type === "choice") {
        return {
          name,
          kind: "select",
          value: String(answer.choice),
          confidence: answer.confidence,
        };
      }
      if (answer.type === "score") {
        return {
          name,
          kind: "score",
          value: answer.score,
          confidence: answer.confidence,
          max: Math.max(0, ...answer.probabilities.map((p) => p.value)),
        };
      }
      return { name, kind: "refusal" };
    });
  }

  async classify(options: { email: ParsedEmail }): Promise<ClassifiedEmail> {
    const email = options.email;
    const { body, truncated } = truncateBody(email.body, BODY_MAX_CHARS);
    const input = [
      `From: ${email.from}`,
      `Date: ${email.date}`,
      `Subject: ${email.subject}`,
      "",
      headerBlock(email.raw),
      "",
      body,
    ].join("\n");
    const decision = await this.#client.decisions.create({
      model: MODEL,
      input,
      questions: this.translateQuestions(buildQuestions({ email })),
    });
    return {
      id: email.messageId,
      email,
      answers: this.translateAnswers(decision),
      truncated,
    };
  }
}