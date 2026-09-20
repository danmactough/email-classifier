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
  /** Jev's full result, or null on a dry run or a failed classification. */
  result: SystemOneResult<EmailQuestions> | null;
  /** Time spent classifying this email, or null when it was not classified. */
  durationMs: number | null;
  /** Classification error message, or null when there was none. */
  error: string | null;
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
  /** Wall-clock ms from run start to report close. */
  elapsedMs: number;
  /** Total ms spent awaiting classification across all emails. */
  classificationMs: number;
  /** Number of emails actually sent to Jev. */
  classified: number;
  /** Number of classifications that failed. */
  classificationErrors: number;
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
      const percent = Math.round(answer.noul * 100);
      parts.push(
        `<div class="answer">${label}<span class="value">${answer.noul.toFixed(2)}</span><span class="bar"><span style="width:${percent}%"></span></span></div>`
      );
    } else {
      parts.push(
        `<div class="answer">${label}<span class="value">${escapeHtml(answer.choice)}</span><span class="conf">${answer.confidence.toFixed(2)}</span></div>`
      );
    }
  }
  return parts.join("");
}

/** Human-readable duration: milliseconds under a second, seconds above. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Run-level timing line for the metadata section. */
export function renderStats(summary: ReportSummary): string {
  const average =
    summary.classified > 0 ? summary.classificationMs / summary.classified : 0;
  const parts = [
    `total time ${formatDuration(summary.elapsedMs)}`,
    `avg classification ${formatDuration(average)}`,
  ];
  if (summary.classified > 0) parts.push(`classified ${summary.classified}`);
  if (summary.classificationErrors > 0) {
    parts.push(`classification errors ${summary.classificationErrors}`);
  }
  return parts.join(" · ");
}

// Render HTML bodies with scripts, remote resources, and navigation disabled:
// the sandbox blocks everything, and the CSP blocks remote loads (tracking
// pixels) while still allowing the inline styles mail clients emit.
const BODY_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

function renderBody(email: ParsedEmail): string {
  if (email.htmlBody) {
    const doc = [
      "<!doctype html>",
      '<meta charset="utf-8">',
      `<meta http-equiv="Content-Security-Policy" content="${BODY_CSP}">`,
      `<body>${email.htmlBody}</body>`,
    ].join("");
    return `<iframe class="html-body" sandbox="" srcdoc="${escapeHtml(doc)}"></iframe>`;
  }
  return `<pre>${escapeHtml(email.body)}</pre>`;
}

/** Render one `<tr>`; escapes all email-derived text. */
export function renderRow(row: ReportRow, index: number): string {
  const id = `body-${index}`;
  const preview = row.email.body.replace(/\s+/g, " ").trim().slice(0, 120);
  let answers: string;
  if (row.result) {
    answers = renderAnswers(row.result);
  } else if (row.error) {
    answers = `<span class="failed">failed: ${escapeHtml(row.error)}</span>`;
  } else {
    answers = '<span class="dry">dry run</span>';
  }
  if (row.durationMs != null) {
    answers += `<div class="duration">${formatDuration(row.durationMs)}</div>`;
  }
  const title = row.email.subject || row.email.messageId;
  return [
    "<tr>",
    `<td class="mono">${escapeHtml(row.email.messageId)}</td>`,
    `<td>${escapeHtml(row.email.from)}</td>`,
    `<td>${escapeHtml(row.email.date)}</td>`,
    `<td class="subject">${escapeHtml(row.email.subject)}</td>`,
    `<td><span class="preview">${escapeHtml(preview)}</span> <button class="view" data-modal="${id}">View</button>`,
    `<div class="modal" id="${id}" hidden><div class="modal-box"><div class="modal-head"><span class="title">${escapeHtml(title)}</span><button class="close">Close</button></div><div class="modal-body">${renderBody(row.email)}</div></div></div>`,
    "</td>",
    `<td class="answers">${answers}</td>`,
    "</tr>",
  ].join("");
}

/** Render the summary footer. */
export function renderSummary(summary: ReportSummary): string {
  const failures =
    summary.classificationErrors > 0
      ? ` · classification errors ${summary.classificationErrors}`
      : "";
  return `<footer class="summary">total ${summary.total} · parsed ${summary.success} · errors ${summary.error} · matched ${summary.matched}${failures}</footer>`;
}

const STYLE = `
* { box-sizing: border-box; }
body { margin: 0; background: #f6f7f9; color: #1f2328; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
.wrap { max-width: 1400px; margin: 0 auto; padding: 28px 20px 40px; }
.page { display: flex; align-items: center; gap: 10px; }
h1 { font-size: 20px; margin: 0; }
.badge { padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; }
.badge.live { background: #dcfce7; color: #166534; }
.badge.dry { background: #e5e7eb; color: #4b5563; }
.meta { color: #6b7280; font-size: 13px; margin: 6px 0 18px; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.05); }
.scroll { overflow: auto; max-height: 75vh; }
table { border-collapse: collapse; width: 100%; min-width: 64rem; table-layout: fixed; }
td, th { overflow-wrap: anywhere; }
thead th { position: sticky; top: 0; z-index: 1; background: #fafbfc; padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
tbody td { padding: 10px 12px; border-bottom: 1px solid #f1f2f4; vertical-align: top; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover { background: #fafbfc; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #374151; }
.subject { font-weight: 600; }
.preview { color: #4b5563; }
.answers { display: block; }
.answer { margin-bottom: 6px; }
.answer:last-child { margin-bottom: 0; }
.answer .key { display: block; color: #6b7280; font-size: 11px; line-height: 1.35; }
.answer .value { font-weight: 600; }
.answer .conf { color: #9ca3af; font-size: 12px; margin-left: 4px; }
.bar { display: inline-block; width: 72px; height: 6px; margin-left: 6px; vertical-align: middle; border-radius: 999px; background: #eef0f2; overflow: hidden; }
.bar span { display: block; height: 100%; background: #2563eb; border-radius: 999px; }
.dry { color: #9ca3af; font-style: italic; }
.failed { color: #b91c1c; font-style: italic; }
.duration { margin-top: 2px; color: #9ca3af; font-size: 11px; }
button.view, button.close { cursor: pointer; font: inherit; font-size: 12px; padding: 2px 9px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; color: #374151; }
button.view:hover, button.close:hover { background: #f3f4f6; }
.modal { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(17,24,39,.55); }
.modal[hidden] { display: none; }
.modal-box { display: flex; flex-direction: column; width: min(1000px, 100%); max-height: 85vh; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 20px 45px rgba(0,0,0,.3); }
.modal-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #e5e7eb; }
.modal-head .title { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.modal-body { padding: 16px; overflow: auto; }
iframe.html-body { width: 100%; height: 60vh; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.summary { margin: 14px 2px 0; color: #6b7280; font-size: 13px; }
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
<div class="wrap">
<header class="page">
<h1>Jev report</h1>
<span class="badge ${meta.live ? "live" : "dry"}">${meta.live ? "live" : "dry run"}</span>
</header>
<p class="meta">source ${escapeHtml(meta.source)} · started ${escapeHtml(meta.startedAt.toISOString())} · <span id="run-stats">timing…</span></p>
<div class="card">
<div class="scroll">
<table>
<colgroup>
<col style="width:15%">
<col style="width:13%">
<col style="width:11%">
<col style="width:17%">
<col style="width:24%">
<col style="width:20%">
</colgroup>
<thead><tr><th>Message-ID</th><th>From</th><th>Date</th><th>Subject</th><th>Body</th><th>Jev responses</th></tr></thead>
<tbody>
`;
}

function renderTail(summary: ReportSummary): string {
  return `</tbody>
</table>
</div>
</div>
${renderSummary(summary)}
</div>
<script>${SCRIPT}</script>
<script>document.getElementById("run-stats").textContent = ${JSON.stringify(renderStats(summary))};</script>
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
