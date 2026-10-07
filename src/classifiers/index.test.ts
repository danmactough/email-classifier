import { describe, expect, it } from "vitest";
import { createClassifier } from "./index.ts";
import { JevClassifier } from "./jev.ts";

describe("createClassifier", () => {
  it("returns null unless CLASSIFIER is set to a name", () => {
    expect(createClassifier({})).toBeNull();
    expect(createClassifier({ CLASSIFIER: "" })).toBeNull();
    expect(createClassifier({ CLASSIFIER: "  " })).toBeNull();
  });

  it("builds a JevClassifier for CLASSIFIER=jev, trimmed", () => {
    const classifier = createClassifier({
      CLASSIFIER: " jev ",
      TYPESAFE_API_KEY: "test",
    });

    expect(classifier).toBeInstanceOf(JevClassifier);
    expect(classifier?.name).toBe("jev");
  });

  it("requires TYPESAFE_API_KEY for the jev classifier", () => {
    expect(() => createClassifier({ CLASSIFIER: "jev" })).toThrow(
      "CLASSIFIER=jev requires TYPESAFE_API_KEY"
    );
    expect(() =>
      createClassifier({ CLASSIFIER: "jev", TYPESAFE_API_KEY: "   " })
    ).toThrow("CLASSIFIER=jev requires TYPESAFE_API_KEY");
  });

  it("a dry run does not require TYPESAFE_API_KEY", () => {
    expect(createClassifier({ CLASSIFIER: "" })).toBeNull();
  });

  it("rejects an unsupported classifier name", () => {
    expect(() => createClassifier({ CLASSIFIER: "other" })).toThrow(
      'unsupported CLASSIFIER "other" (supported: jev, openai)'
    );
  });
});