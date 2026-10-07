import { describe, expect, it } from "vitest";
import { createClassifier } from "./index.ts";
import { JevClassifier } from "./jev.ts";
import { OpenAIClassifier } from "./openai.ts";

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

  it("builds an OpenAIClassifier for CLASSIFIER=openai, trimmed", () => {
    const classifier = createClassifier({
      CLASSIFIER: " openai ",
      OPENAPI_API_KEY: "test",
    });

    expect(classifier).toBeInstanceOf(OpenAIClassifier);
    expect(classifier?.name).toBe("openai");
  });

  it("requires OPENAPI_API_KEY for the openai classifier", () => {
    expect(() => createClassifier({ CLASSIFIER: "openai" })).toThrow(
      "CLASSIFIER=openai requires OPENAPI_API_KEY"
    );
    expect(() =>
      createClassifier({ CLASSIFIER: "openai", OPENAPI_API_KEY: "   " })
    ).toThrow("CLASSIFIER=openai requires OPENAPI_API_KEY");
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