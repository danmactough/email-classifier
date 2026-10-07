import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParsedEmail } from "./types.ts";

const FILTER_KEYS = [
  "FROM_FILTER",
  "DATE_FILTER",
  "SUBJECT_FILTER",
  "BODY_FILTER",
  "DATE_SINCE",
  "LOG_SKIPPED",
] as const;

function email(overrides: Partial<ParsedEmail>): ParsedEmail {
  return {
    messageId: "<x@example.com>",
    from: "sender@example.com",
    fromParsed: { name: "sender" },
    date: "Mon, 3 Jan 2022 09:12:00 -0500",
    dateParsed: new Date("2022-01-03T14:12:00.000Z"),
    subject: "Subject",
    body: "Body",
    htmlBody: null,
    raw: "",
    ...overrides,
  };
}

// app.ts builds its filters from process.env at import time and loads .env on
// import, so each case stubs the loader, sets env, then imports a fresh module.
async function loadApp(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.restoreAllMocks();
  for (const key of FILTER_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  vi.spyOn(process, "loadEnvFile").mockImplementation(() => {});
  return import("./app.ts");
}

afterEach(() => {
  for (const key of FILTER_KEYS) delete process.env[key];
  vi.restoreAllMocks();
});

describe("shouldClassify", () => {
  it("matches everything when no filters are set, but requires a parsed date", async () => {
    const { shouldClassify } = await loadApp();

    expect(shouldClassify(email({}))).toBe(true);
    expect(shouldClassify(email({ dateParsed: null }))).toBe(false);
  });

  it("requires every field filter to match", async () => {
    const { shouldClassify } = await loadApp({
      FROM_FILTER: "invoice",
      SUBJECT_FILTER: "receipt",
    });

    expect(
      shouldClassify(email({ from: "Invoice Bot", subject: "Your receipt" }))
    ).toBe(true);
    expect(shouldClassify(email({ from: "Invoice Bot", subject: "Hello" }))).toBe(
      false
    );
    expect(
      shouldClassify(email({ from: "Other", subject: "Your receipt" }))
    ).toBe(false);
  });

  it("gates on DATE_SINCE and the raw Date: string", async () => {
    const { shouldClassify } = await loadApp({
      DATE_SINCE: "2023-01-01T00:00:00Z",
      DATE_FILTER: "2024",
    });

    expect(
      shouldClassify(
        email({ date: "Tue, 1 Jan 2024 10:00:00 -0500", dateParsed: new Date("2024-01-01T15:00:00Z") })
      )
    ).toBe(true);
    expect(
      shouldClassify(
        email({ date: "Tue, 1 Jan 2024 10:00:00 -0500", dateParsed: new Date("2022-06-01T15:00:00Z") })
      )
    ).toBe(false);
    expect(
      shouldClassify(
        email({ date: "Sun, 1 Jan 2023 10:00:00 -0500", dateParsed: new Date("2024-01-01T15:00:00Z") })
      )
    ).toBe(false);
  });

  it("treats BODY_FILTER as dotall so . spans newlines", async () => {
    const { shouldClassify } = await loadApp({ BODY_FILTER: "start.*end" });

    expect(shouldClassify(email({ body: "start\nend" }))).toBe(true);
    expect(shouldClassify(email({ body: "start and then stop" }))).toBe(false);
  });

  it("logs skipped emails when LOG_SKIPPED is set", async () => {
    const { shouldClassify } = await loadApp({
      FROM_FILTER: "invoice",
      LOG_SKIPPED: "1",
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(shouldClassify(email({ from: "Other" }))).toBe(false);

    expect(errorSpy).toHaveBeenCalledWith(
      "skipping",
      "<x@example.com>",
      "Other",
      "Subject",
      expect.stringContaining("from")
    );
  });

  it("does not mutate the email", async () => {
    const { shouldClassify } = await loadApp();
    const input = email({});
    const before = structuredClone(input);

    shouldClassify(input);

    expect(input).toEqual(before);
  });
});

