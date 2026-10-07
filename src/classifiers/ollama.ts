import type { SystemOneResult } from "@typesafe-ai/sdk";
import type { Answer } from "../types.ts";
import { JevClassifier, type EmailQuestions } from "./jev.ts";

/**
 * Default for OLLAMA_BODY_MAX_CHARS: the char cap on the message body (the
 * endpoint budgets tokens, not chars).
 */
export const DEFAULT_BODY_MAX_CHARS = 200_000;

/** Default for OLLAMA_BASE_URL: where Ollama serves `/v1/systemone`. */
export const DEFAULT_BASE_URL = "http://localhost:11434";

/** Ollama's endpoint accepts 2–26 criteria per choice question. */
export const MAX_CHOICE_CRITERIA = 26;

/**
 * Marks the synthesized second criterion for a choice that has one real
 * option: translateAnswers strips the mark so either answer maps back onto
 * the option's value.
 */
export const ONLY_OPTION = "only-option:";

/** Ollama classifier ("ollama"): the System One port for an Ollama server. */
export class OllamaClassifier extends JevClassifier {
  override readonly name = "ollama";

  constructor(options: { model: string; baseURL?: string; bodyMaxChars?: number }) {
    super({
      // Ollama ignores the API key, but the TypeSafe SDK requires a non-empty one.
      apiKey: "ollama",
      baseURL: options.baseURL ?? DEFAULT_BASE_URL,
      model: options.model,
      bodyMaxChars: options.bodyMaxChars ?? DEFAULT_BODY_MAX_CHARS,
      // Loading a multi-GB model can far exceed the SDK's default 10s per attempt.
      timeout: 120_000,
    });
  }

  /** Fit a question's options into the endpoint's 2–26 criteria window. */
  protected override choiceCriteria(
    options: Array<{ value: string; description?: string }>,
  ): Record<string, string | null> {
    // The generic set orders real candidates first and the fallback (`none`)
    // last, so an over-cap question keeps the candidate head plus the
    // fallback; the middle candidates were already the least likely.
    if (options.length > MAX_CHOICE_CRITERIA) {
      return super.choiceCriteria([...options.slice(0, MAX_CHOICE_CRITERIA - 1), options.at(-1)!]);
    }
    // An under-cap question gains a marked twin criterion that describes the
    // same option, because the endpoint needs at least two criteria.
    if (options.length === 1) {
      const option = options[0]!;
      return {
        ...super.choiceCriteria(options),
        [`${ONLY_OPTION}${option.value}`]: option.description ?? null,
      };
    }
    return super.choiceCriteria(options);
  }

  /** Map the ONLY_OPTION twin back onto the option's generic value. */
  override translateAnswers(raw: SystemOneResult<EmailQuestions>): Answer[] {
    return super.translateAnswers(raw).map((answer) => {
      if (answer.kind !== "select") return answer;
      return {
        ...answer,
        value: answer.value.startsWith(ONLY_OPTION)
          ? answer.value.slice(ONLY_OPTION.length)
          : answer.value,
      };
    });
  }
}
