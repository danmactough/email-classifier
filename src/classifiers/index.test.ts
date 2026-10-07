import { describe, expect, it } from "vite-plus/test";
import { createClassifier } from "./index.ts";
import { JevClassifier } from "./jev.ts";
import { OllamaClassifier } from "./ollama.ts";
import { OpenAIClassifier } from "./openai.ts";

describe("createClassifier", () => {
  describe("base case", () => {
    it("returns null unless CLASSIFIER is set to a name", () => {
      expect(createClassifier({})).toBeNull();
      expect(createClassifier({ CLASSIFIER: "" })).toBeNull();
      expect(createClassifier({ CLASSIFIER: "  " })).toBeNull();
    });

    it("rejects an unsupported classifier name", () => {
      expect(() => createClassifier({ CLASSIFIER: "other" })).toThrow(
        'unsupported CLASSIFIER "other" (supported: jev, openai, ollama)',
      );
    });
  });

  describe("Jev", () => {
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
        "CLASSIFIER=jev requires TYPESAFE_API_KEY",
      );
      expect(() => createClassifier({ CLASSIFIER: "jev", TYPESAFE_API_KEY: "   " })).toThrow(
        "CLASSIFIER=jev requires TYPESAFE_API_KEY",
      );
    });
  });

  describe("OpenAI", () => {
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
        "CLASSIFIER=openai requires OPENAPI_API_KEY",
      );
      expect(() => createClassifier({ CLASSIFIER: "openai", OPENAPI_API_KEY: "   " })).toThrow(
        "CLASSIFIER=openai requires OPENAPI_API_KEY",
      );
    });
  });

  describe("Ollama", () => {
    it("builds an OllamaClassifier for CLASSIFIER=ollama with OLLAMA_MODEL set, trimmed", () => {
      const classifier = createClassifier({ CLASSIFIER: " ollama ", OLLAMA_MODEL: " clef-flash " });

      expect(classifier).toBeInstanceOf(OllamaClassifier);
      expect(classifier?.name).toBe("ollama");
    });

    it("requires OLLAMA_MODEL for the ollama classifier", () => {
      expect(() => createClassifier({ CLASSIFIER: "ollama" })).toThrow(
        "CLASSIFIER=ollama requires OLLAMA_MODEL",
      );
      expect(() => createClassifier({ CLASSIFIER: "ollama", OLLAMA_MODEL: "   " })).toThrow(
        "CLASSIFIER=ollama requires OLLAMA_MODEL",
      );
    });

    it("rejects an invalid OLLAMA_BODY_MAX_CHARS", () => {
      for (const value of ["abc", "0", "-5", "10.5"]) {
        expect(() =>
          createClassifier({
            CLASSIFIER: "ollama",
            OLLAMA_MODEL: "x",
            OLLAMA_BODY_MAX_CHARS: value,
          }),
        ).toThrow(`OLLAMA_BODY_MAX_CHARS must be a positive integer, got "${value}"`);
      }
    });
  });
});
