import type { Classifier } from "./base.ts";
import { JevClassifier } from "./jev.ts";

/** Build the classifier named by `CLASSIFIER`, or null for a dry run. */
export function createClassifier(env: NodeJS.ProcessEnv): Classifier | null {
  const name = env.CLASSIFIER?.trim();
  if (!name) return null;
  if (name === "jev") {
    const apiKey = env.TYPESAFE_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "CLASSIFIER=jev requires TYPESAFE_API_KEY (set it in .env)"
      );
    }
    return new JevClassifier({ apiKey });
  }
  throw new Error(`unsupported CLASSIFIER "${name}" (supported: jev, openai)`);
}