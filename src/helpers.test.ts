import { describe, expect, it } from "vitest";
import {
  MAX_CANDIDATES,
  dedupe,
  displayName,
  getListOfEmailAddresses,
  getListOfProperNouns,
  getListOfWords,
  signatureRegion,
} from "./helpers.ts";

/** Base-26 lowercase letters for a non-negative index, so generated names differ. */
function letters(index: number): string {
  let out = "";
  let n = index;
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

describe("displayName", () => {
  it("extracts the display name and strips surrounding quotes", () => {
    expect(displayName('"Mick Jones" <mick@example.com>')).toBe("Mick Jones");
    expect(displayName("Acme Support <help@acme.example>")).toBe("Acme Support");
  });

  it("returns an empty string for a bare address", () => {
    expect(displayName("mick@example.com")).toBe("");
    expect(displayName("<mick@example.com>")).toBe("");
    expect(displayName("")).toBe("");
  });

  it("keeps apostrophes inside a name", () => {
    expect(displayName("O'Brien Support <help@acme.example>")).toBe(
      "O'Brien Support"
    );
    expect(displayName("'Quoted' <help@acme.example>")).toBe("Quoted");
  });
});

describe("dedupe", () => {
  it("trims, drops blanks, duplicates, and the none label, and caps", () => {
    expect(dedupe([" a ", "a", "", "b", "none", "c", "d"], 3)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns nothing for a non-positive limit", () => {
    expect(dedupe(["a", "b"], 0)).toEqual([]);
    expect(dedupe(["a", "b"], -1)).toEqual([]);
  });
});

describe("signatureRegion", () => {
  it("returns the last fifteen non-empty lines, joined", () => {
    const lines = Array.from({ length: 20 }, (_, index) => `L${index}`);

    const region = signatureRegion(lines.join("\n"));

    expect(region).not.toContain("L4");
    expect(region).toContain("L5");
    expect(region).toContain("L19");
  });
});

describe("getListOfProperNouns", () => {
  it("finds proper-noun sequences, deduped in first-seen order", () => {
    const names = getListOfProperNouns(
      "Thanks,\nMick Jones\nAcme Cloud Team\nMick Jones\n"
    );

    expect(names).toContain("Mick Jones");
    expect(names).toContain("Acme Cloud Team");
    expect(new Set(names).size).toBe(names.length);
  });

  it("does not merge a name across lines", () => {
    const names = getListOfProperNouns(
      "Thanks,\nMick Jones\nHead of Support\nAcme Inc\n"
    );

    expect(names).toContain("Mick Jones");
    expect(names.every((name) => !name.includes("\n"))).toBe(true);
    expect(names).not.toContain("Mick Jones\nHead");
  });

  it("returns an empty list when there is nothing to find", () => {
    expect(getListOfProperNouns("all lowercase words here")).toEqual([]);
  });

  it("defaults to MAX_CANDIDATES and honors max", () => {
    const words = Array.from(
      { length: 150 },
      (_, index) => `Name${letters(index)}`
    );
    const text = words.join("\n");

    expect(getListOfProperNouns(text)).toHaveLength(MAX_CANDIDATES);
    expect(getListOfProperNouns(text, { max: 5 })).toHaveLength(5);
  });
});

describe("getListOfEmailAddresses", () => {
  it("finds addresses, deduped in first-seen order", () => {
    const emails = getListOfEmailAddresses(
      "From a@x.com, cc a@x.com and b@y.org."
    );

    expect(emails).toEqual(["a@x.com", "b@y.org"]);
  });

  it("returns an empty list when there are no addresses", () => {
    expect(getListOfEmailAddresses("no addresses here")).toEqual([]);
  });

  it("defaults to MAX_CANDIDATES and honors max", () => {
    const addresses = Array.from(
      { length: 150 },
      (_, index) => `user${index}@example.com`
    );
    const text = addresses.join("\n");

    expect(getListOfEmailAddresses(text)).toHaveLength(MAX_CANDIDATES);
    expect(getListOfEmailAddresses(text, { max: 2 })).toEqual([
      "user0@example.com",
      "user1@example.com",
    ]);
  });
});

describe("getListOfWords", () => {
  it("drops default stop words and keeps first-seen order", () => {
    expect(getListOfWords("The quick brown fox jumps over the lazy dog")).toEqual(
      ["quick", "brown", "fox", "jumps", "lazy", "dog"]
    );
  });

  it("extends the default list with additionalStopWords", () => {
    expect(
      getListOfWords("alpha beta gamma", { additionalStopWords: ["beta"] })
    ).toEqual(["alpha", "gamma"]);
  });

  it("replaces the default list with stopWords", () => {
    expect(getListOfWords("the alpha beta", { stopWords: ["alpha"] })).toEqual([
      "the",
      "beta",
    ]);
  });

  it("dedupes and caps the result", () => {
    expect(getListOfWords("alpha alpha beta gamma", { max: 2 })).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("returns an empty list for empty or all-stop-word text", () => {
    expect(getListOfWords("")).toEqual([]);
    expect(getListOfWords("the and of")).toEqual([]);
  });
});
