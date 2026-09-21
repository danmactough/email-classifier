import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatDuration,
  openReport,
  renderRow,
  renderStats,
  renderSummary,
  reportPath,
  type ReportRow,
} from "./report.ts";
import type { ParsedEmail } from "./types.ts";

const RESULT = {
  model: "jev-test",
  answers: {
    related_to_subscription: { type: "noul", noul: 0.97 },
    related_to_physical_goods: { type: "noul", noul: 0.02 },
    related_to_services: { type: "noul", noul: 0.95 },
    category: {
      type: "choice",
      choice: "trial_ending",
      confidence: 0.88,
      probabilities: { trial_ending: 0.88 },
    },
    sender_name: {
      type: "choice",
      choice: "none",
      confidence: 0.6,
      probabilities: { none: 0.6 },
    },
    sender_email: {
      type: "choice",
      choice: "none",
      confidence: 0.6,
      probabilities: { none: 0.6 },
    },
  },
  usage: { input_tokens: 1, output_tokens: 1 },
} as unknown as NonNullable<ReportRow["result"]>;

function email(overrides: Partial<ParsedEmail>): ParsedEmail {
  return {
    messageId: "<x@example.com>",
    from: "",
    date: "",
    dateParsed: null,
    subject: "",
    body: "",
    htmlBody: null,
    raw: "",
    ...overrides,
  };
}

describe("reportPath", () => {
  it("names the file with the epoch ms of the start time", () => {
    const target = reportPath({ startedAt: new Date(1700000000000) });

    expect(target.startsWith("/")).toBe(true);
    expect(target.endsWith("jev-report-1700000000000.html")).toBe(true);
  });
});

describe("renderRow", () => {
  it("renders the six columns and embeds the body in a modal", () => {
    const row = renderRow(
      {
        email: email({
          messageId: "<a@b>",
          from: "A <a@b>",
          date: "Mon, 3 Jan 2022 09:12:00 -0500",
          subject: "S",
          body: "line1\nline2",
        }),
        result: null,
        durationMs: null,
        error: null,
        truncated: false,
      },
      3
    );

    expect((row.match(/<td/g) ?? []).length).toBe(6);
    expect(row).toContain("Mon, 3 Jan 2022 09:12:00 -0500");
    expect(row).toContain('data-modal="body-3"');
    expect(row).toContain('<div class="modal" id="body-3"');
    expect(row).toContain("line1\nline2");
  });

  it("escapes every message-derived field", () => {
    const row = renderRow(
      {
        email: email({
          messageId: "<x&y>",
          from: "a<b>",
          subject: "s<t>",
          body: "b&c<d>",
        }),
        result: null,
        durationMs: null,
        error: null,
        truncated: false,
      },
      0
    );

    expect(row).toContain("&lt;x&amp;y&gt;");
    expect(row).toContain("a&lt;b&gt;");
    expect(row).toContain("s&lt;t&gt;");
    expect(row).toContain("b&amp;c&lt;d&gt;");
    expect(row).not.toContain("<x&y>");
  });

  it("shows a placeholder for a dry run and the answers for a result", () => {
    const dry = renderRow(
      {
        email: email({ body: "x" }),
        result: null,
        durationMs: null,
        error: null,
        truncated: false,
      },
      0
    );
    expect(dry).toContain("dry run");

    const live = renderRow(
      {
        email: email({ body: "x" }),
        result: RESULT,
        durationMs: null,
        error: null,
        truncated: false,
      },
      1
    );
    expect(live).toContain("trial_ending");
    expect(live).toContain("0.97");
    expect(live).toContain("0.88");
    expect(live).not.toContain("dry run");
  });

  it("shows the classification duration and marks a failure", () => {
    const live = renderRow(
      {
        email: email({ body: "x" }),
        result: RESULT,
        durationMs: 456,
        error: null,
        truncated: false,
      },
      7
    );
    expect(live).toContain("456 ms");

    const failed = renderRow(
      {
        email: email({ body: "x" }),
        result: null,
        durationMs: 210,
        error: '400 {"detail":{"error_type":"max_tokens_exceeded"}}',
        truncated: false,
      },
      8
    );
    expect(failed).toContain("failed");
    expect(failed).toContain("max_tokens_exceeded");
    expect(failed).toContain("210 ms");

    const dry = renderRow(
      {
        email: email({ body: "x" }),
        result: null,
        durationMs: null,
        error: null,
        truncated: false,
      },
      9
    );
    expect(dry).toContain("dry run");
  });

  it("notes a truncated body", () => {
    const row = renderRow(
      {
        email: email({ body: "x" }),
        result: RESULT,
        durationMs: 10,
        error: null,
        truncated: true,
      },
      11
    );

    expect(row).toContain("body truncated");
  });

  it("renders an HTML body in a locked-down iframe, falling back to pre", () => {
    const withHtml = renderRow(
      {
        email: email({ htmlBody: "<p>Hi <b>there</b></p>", body: "Hi there" }),
        result: null,
        durationMs: null,
        error: null,
        truncated: false,
      },
      5
    );

    expect(withHtml).toContain('class="html-body"');
    expect(withHtml).toContain('sandbox=""');
    expect(withHtml).toContain('srcdoc="');
    expect(withHtml).toContain("Content-Security-Policy");
    expect(withHtml).toContain("img-src data: https: http:");
    expect(withHtml).toContain("style-src");
    expect(withHtml).toContain("&lt;p&gt;Hi &lt;b&gt;there&lt;/b&gt;&lt;/p&gt;");
    expect(withHtml).not.toContain("<p>Hi <b>there</b></p>");

    const noHtml = renderRow(
      {
        email: email({ htmlBody: null, body: "plain text" }),
        result: null,
        durationMs: null,
        error: null,
        truncated: false,
      },
      6
    );
    expect(noHtml).toContain("<pre>plain text</pre>");
    expect(noHtml).not.toContain("<iframe");
  });
});

describe("renderSummary", () => {
  it("reports the four counts", () => {
    const footer = renderSummary({
      total: 5,
      success: 4,
      error: 1,
      matched: 2,
      elapsedMs: 0,
      classificationMs: 0,
      classified: 0,
      classificationErrors: 0,
    });

    expect(footer).toContain("total 5");
    expect(footer).toContain("parsed 4");
    expect(footer).toContain("errors 1");
    expect(footer).toContain("matched 2");
  });
});

describe("formatDuration", () => {
  it("shows milliseconds under a second and seconds above", () => {
    expect(formatDuration(456)).toBe("456 ms");
    expect(formatDuration(12345)).toBe("12.3 s");
  });
});

describe("renderStats", () => {
  it("reports total time, average classification, and count", () => {
    const stats = renderStats({
      total: 10,
      success: 10,
      error: 0,
      matched: 3,
      elapsedMs: 12345,
      classificationMs: 900,
      classified: 3,
      classificationErrors: 2,
    });

    expect(stats).toContain("total time 12.3 s");
    expect(stats).toContain("avg classification 300 ms");
    expect(stats).toContain("classified 3");
    expect(stats).toContain("classification errors 2");
  });

  it("handles zero classifications without dividing by zero", () => {
    const stats = renderStats({
      total: 1,
      success: 1,
      error: 0,
      matched: 0,
      elapsedMs: 500,
      classificationMs: 0,
      classified: 0,
      classificationErrors: 0,
    });

    expect(stats).toContain("total time 500 ms");
    expect(stats).toContain("avg classification 0 ms");
    expect(stats).not.toContain("classified 0");
    expect(stats).not.toContain("classification errors");
  });
});

describe("openReport", () => {
  it("writes the head, a row, and the footer to the epoch-named file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-report-"));
    try {
      const startedAt = new Date(1700000000000);
      const writer = await openReport({
        meta: { source: "sample.mbox", live: false, startedAt },
        dir,
      });
      await writer.addRow({
        email: email({ messageId: "<row@x>", body: "hello" }),
        result: null,
        durationMs: null,
        error: null,
        truncated: false,
      });
      await writer.close({
        total: 1,
        success: 1,
        error: 0,
        matched: 1,
        elapsedMs: 1234,
        classificationMs: 0,
        classified: 0,
        classificationErrors: 0,
      });

      expect(writer.path).toBe(reportPath({ startedAt, dir }));
      const html = await readFile(writer.path, "utf8");
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html.trimEnd().endsWith("</html>")).toBe(true);
      expect(html).toContain("&lt;row@x&gt;");
      expect(html).toContain("hello");
      expect(html).toContain("matched 1");
      expect(html).toContain('class="scroll"');
      expect(html).toContain("<colgroup>");
      expect(html).toContain("run-stats");
      expect(html).toContain("total time 1.2 s");
      expect(html).toContain('http-equiv="Content-Security-Policy"');
      expect(html).toContain("img-src data: https: http:");
      expect(html).toContain("frame-src");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
