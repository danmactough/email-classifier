import type {
  Answer,
  ClassifiedEmail,
  ParsedEmail,
  Question,
} from "../types.ts";

/**
 * A supported email classifier. `CLASSIFIER` selects the implementation by
 * name; to support a new one, add a concrete class next to this file and a
 * matching case in `createClassifier`.
 *
 * The port has three points of contact with an implementation: `classify`
 * drives the pipeline, `translateQuestions` maps the generic questions into
 * the implementation's wire format, and `translateAnswers` maps the raw
 * response into the generic answers the report renders.
 */
export abstract class Classifier {
  /** Name recorded in report metadata and matched against `CLASSIFIER`. */
  abstract readonly name: string;

  /** Map the generic questions into this classifier's wire format. */
  abstract translateQuestions(questions: Question[]): unknown;

  /** Convert this classifier's raw response into the generic answers. */
  abstract translateAnswers(raw: unknown): Answer[];

  /** Classify one email; returns its answers in the generic format. */
  abstract classify(options: { email: ParsedEmail }): Promise<ClassifiedEmail>;
}