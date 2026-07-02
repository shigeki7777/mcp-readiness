#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { auditServer } from "../src/audit.mjs";

const endpoint = String(process.env.SASAME_MCP_ENDPOINT || "").trim();
const minGrade = String(process.env.SASAME_MIN_GRADE || "B").trim().toUpperCase();
const reportPath = resolve(String(process.env.SASAME_REPORT_PATH || "mcp-readiness-report.json"));
const ranks = { A: 4, B: 3, C: 2, D: 1 };

function command(name, value) {
  const safe = String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  process.stdout.write(`::${name}::${safe}\n`);
}

async function append(path, value) {
  if (!path) return;
  const { appendFile } = await import("node:fs/promises");
  await appendFile(path, value);
}

function markdown(report, accepted) {
  const mark = accepted ? "✅" : "❌";
  const rows = report.criteria.map((item) =>
    `| ${item.pass ? "✅" : "❌"} | ${item.id} | ${item.name} | ${String(item.evidence || "").replace(/\|/g, "\\|")} |`
  ).join("\n");
  const blockers = report.preflight?.checks?.filter((item) => item.pass === false) || [];
  const preflight = blockers.length
    ? `\n### Directory pre-flight\n\n${blockers.map((item) => `- **${item.id} ${item.name}:** ${item.evidence}`).join("\n")}\n`
    : "";
  return `## ${mark} SaSame MCP Readiness: ${report.grade}\n\n` +
    `**${report.passes}/${report.total} criteria** · ${report.tool_count} tools · ${report.latency_ms} ms · minimum ${minGrade}\n\n` +
    `Endpoint: \`${report.subject}\`\n\n` +
    `| | Check | Criterion | Evidence |\n|---|---|---|---|\n${rows}\n\n` +
    `**Top fix:** ${report.top_gap || "None — every criterion passed."}\n${preflight}\n` +
    `<sub>Measured by [mcp-readiness](https://github.com/shigeki7777/mcp-readiness). A readiness grade is a mechanical measurement, not a security certification or endorsement.</sub>\n`;
}

if (!endpoint || !/^https?:\/\//.test(endpoint)) {
  command("error title=Invalid MCP endpoint", "The endpoint input must be an http:// or https:// URL.");
  process.exit(2);
}
if (!ranks[minGrade]) {
  command("error title=Invalid minimum grade", "min-grade must be A, B, C, or D.");
  process.exit(2);
}

try {
  const report = await auditServer(endpoint);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");

  const accepted = ranks[report.grade] >= ranks[minGrade];
  await append(process.env.GITHUB_STEP_SUMMARY, markdown(report, accepted));
  await append(process.env.GITHUB_OUTPUT, `grade=${report.grade}\npasses=${report.passes}\nreport-path=${reportPath}\n`);

  for (const item of report.criteria.filter((criterion) => !criterion.pass)) {
    command("warning title=" + item.id + " " + item.name, item.evidence);
  }
  command(accepted ? "notice title=MCP readiness passed" : "error title=MCP readiness below threshold",
    `Grade ${report.grade}; required ${minGrade}; ${report.passes}/${report.total} criteria passed.`);
  process.exit(accepted ? 0 : 1);
} catch (error) {
  command("error title=MCP readiness audit failed", String(error?.message || error));
  process.exit(2);
}
