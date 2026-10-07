import type { Classifier } from "./base.ts";
import { JevClassifier } from "./jev.ts";
import { OllamaClassifier } from "./ollama.ts";
import { OpenAIClassifier } from "./openai.ts";

/** Build the classifier named by `CLASSIFIER`, or null for a dry run. */
export function createClassifier(env: NodeJS.ProcessEnv): Classifier | null {
  const name = env.CLASSIFIER?.trim();
  if (!name) return null;
  if (name === "jev") {
    const apiKey = env.TYPESAFE_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("CLASSIFIER=jev requires TYPESAFE_API_KEY (set it in .env)");
    }
    return new JevClassifier({ apiKey });
  }
  if (name === "openai") {
    const apiKey = env.OPENAPI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("CLASSIFIER=openai requires OPENAPI_API_KEY (set it in .env)");
    }
    return new OpenAIClassifier({ apiKey });
  }
  if (name === "ollama") {
    const model = env.OLLAMA_MODEL?.trim();
    if (!model) {
      throw new Error("CLASSIFIER=ollama requires OLLAMA_MODEL (set it in .env)");
    }
    const rawBodyMaxChars = env.OLLAMA_BODY_MAX_CHARS?.trim();
    let bodyMaxChars: number | undefined;
    if (rawBodyMaxChars) {
      bodyMaxChars = Number(rawBodyMaxChars);
      if (!Number.isSafeInteger(bodyMaxChars) || bodyMaxChars <= 0) {
        throw new Error(
          `OLLAMA_BODY_MAX_CHARS must be a positive integer, got "${rawBodyMaxChars}"`,
        );
      }
    }
    return new OllamaClassifier({
      model,
      baseURL: env.OLLAMA_BASE_URL?.trim() || undefined,
      bodyMaxChars,
    });
  }
  throw new Error(`unsupported CLASSIFIER "${name}" (supported: jev, openai, ollama)`);
}
