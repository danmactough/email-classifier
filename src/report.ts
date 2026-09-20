import { once } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { SystemOneResult } from "@typesafe-ai/sdk";
import type { EmailQuestions } from "./questions.ts";
import type { ParsedEmail } from "./types.ts";

/** One table row: an email and, on a live run, Jev's answers for it. */
export interface ReportRow {
  email: ParsedEmail;
  /** Jev's full result, or null on a dry run. */
  result: SystemOneResult<EmailQuestions> | null;
}

/** Run metadata rendered at the top of the page. */
export interface ReportMeta {
  /** The mbox path that was read. */
  source: string;
  /** True when Jev was actually called. */
  live: boolean;
  /** Run start time, used for the header and the filename. */
  startedAt: Date;
}

/** Counts rendered in the footer and reused for the console summary. */
export interface ReportSummary {
  total: number;
  success: number;
  error: number;
  matched: number;
}

export interface ReportWriter {
  /** Absolute path of the file being written. */
  readonly path: string;
  /** Append one table row. */
  addRow(row: ReportRow): Promise<void>;
  /** Write the footer and close the file. */
  close(summary: ReportSummary): Promise<void>;
}

/** Absolute path for a run, `reports/jev-report-<epochMs>.html`. */
export function reportPath(options: { startedAt: Date; dir?: string }): string {
  const dir = resolve(options.dir ?? "reports");
  return join(dir, `jev-report-${options.startedAt.getTime()}.html`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderAnswers(result: SystemOneResult<EmailQuestions>): string {
  const parts: string[] = [];
  for (const [key, answer] of Object.entries(result.answers)) {
    const label = `<span class="key">${escapeHtml(key)}</span>`;
    if (answer.type === "noul") {
      parts.push(
        `<div class="answer">${label}<span class="value">${answer.noul.toFixed(2)}</span></div>`
      );
    } else {
      parts.push(
        `<div class="answer">${label}<span class="value">${escapeHtml(answer.choice)}</span><span class="conf">${answer.confidence.toFixed(2)}</span></div>`
      );
    }
  }
  return parts.join("");
}

/** Render one `<tr>`; escapes all email-derived text. */
export function renderRow(row: ReportRow, index: number): string {
  const id = `body-${index}`;
  const preview = row.email.body.replace(/\s+/g, " ").trim().slice(0, 120);
  const answers = row.result
    ? renderAnswers(row.result)
    : '<span class="dry">dry run</span>';
  return [
    "<tr>",
    `<td class="mono">${escapeHtml(row.email.messageId)}</td>`,
    `<td>${escapeHtml(row.email.from)}</td>`,
    `<td>${escapeHtml(row.email.subject)}</td>`,
    `<td>${escapeHtml(preview)} <button class="view" data-modal="${id}">View</button>`,
    `<div class="modal" id="${id}" hidden><div class="modal-box"><button class="close">Close</button><pre>${escapeHtml(row.email.body)}</pre></div></div>`,
    "</td>",
    `<td class="answers">${answers}</td>`,
    "</tr>",
  ].join("");
}

/** Render the summary footer. */
export function renderSummary(summary: ReportSummary): string {
  return `<footer>total ${summary.total} · parsed ${summary.success} · errors ${summary.error} · matched ${summary.matched}</footer>`;
}

const STYLE = `
body { font: 14px system-ui, sans-serif; margin: 1.5rem; color: #1a1a1a; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #d0d0d0; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #f2f2f2; }
.mono { font-family: ui-monospace, monospace; font-size: 12px; }
.answers .answer { display: flex; gap: 6px; }
.answers .key { color: #555; min-width: 12rem; }
.answers .value { font-weight: 600; }
.answers .conf { color: #999; }
.dry { color: #999; font-style: italic; }
.modal { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; }
.modal[hidden] { display: none; }
.modal-box { background: #fff; max-width: 60rem; max-height: 80vh; overflow: auto; padding: 1rem; border-radius: 6px; }
.modal-box pre { white-space: pre-wrap; word-break: break-word; }
footer { margin-top: 1rem; color: #555; }
`;

const SCRIPT = `
document.addEventListener("click", (event) => {
  const view = event.target.closest(".view");
  if (view) { document.getElementById(view.dataset.modal).hidden = false; return; }
  if (event.target.closest(".close") || event.target.classList.contains("modal")) {
    event.target.closest(".modal").hidden = true;
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    document.querySelectorAll(".modal:not([hidden])").forEach((m) => (m.hidden = true));
  }
});
`;

function renderHead(meta: ReportMeta): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jev report — ${escapeHtml(meta.source)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Jev report</h1>
<p class="meta">source: ${escapeHtml(meta.source)} · ${meta.live ? "live" : "dry run"} · started ${escapeHtml(meta.startedAt.toISOString())}</p>
<table>
<thead><tr><th>Message-ID</th><th>From</th><th>Subject</th><th>Body</th><th>Jev responses</th></tr></thead>
<tbody>
`;
}

function renderTail(summary: ReportSummary): string {
  return `</tbody>
</table>
${renderSummary(summary)}
<script>${SCRIPT}</script>
</body>
</html>
`;
}

async function write(stream: WriteStream, chunk: string): Promise<void> {
  if (!stream.write(chunk)) await once(stream, "drain");
}

/** Create the file (and its dir), write the head, return a writer. */
export async function openReport(options: {
  meta: ReportMeta;
  dir?: string;
}): Promise<ReportWriter> {
  const target = reportPath({
    startedAt: options.meta.startedAt,
    dir: options.dir,
  });
  await mkdir(dirname(target), { recursive: true });
  const stream = createWriteStream(target);
  await write(stream, renderHead(options.meta));
  let index = 0;

  return {
    path: target,
    async addRow(row) {
      await write(stream, renderRow(row, index++));
    },
    async close(summary) {
      await write(stream, renderTail(summary));
      stream.end();
      await once(stream, "finish");
    },
  };
}
