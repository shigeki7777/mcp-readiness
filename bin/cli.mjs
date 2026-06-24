#!/usr/bin/env node
// mcp-readiness CLI — `npx mcp-readiness <url>` grades a public MCP server against 10 readiness criteria.
import { auditServer } from "../src/audit.mjs";

const OBSERVATORY = "https://live-vps.sasame.online/public-mcp";
const REPO = "https://github.com/shigeki7777/mcp-readiness";
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const noColor = has("--no-color") || process.env.NO_COLOR;
const asJson = has("--json");
const url = args.find((a) => /^https?:\/\//.test(a));

const C = (code, s) => (noColor ? s : `\x1b[${code}m${s}\x1b[0m`);
const dim = (s) => C("2", s), bold = (s) => C("1", s);
const gradeColor = { A: "32", B: "92", C: "33", D: "31" };

function help() {
  console.log(`
${bold("mcp-readiness")} — readiness audit for public MCP servers (Lighthouse for MCP)

${bold("Usage")}
  npx mcp-readiness <server-url> [--json] [--no-color]

${bold("Example")}
  npx mcp-readiness https://mcp.example.com/mcp
  npx mcp-readiness http://localhost:3000/mcp        # audit your local server while developing

${bold("What it checks")} (10 criteria, A>=10 · B>=8 · C>=5 · D below)
  C1 handshake   C2 tool listability   C3 tool validity   C4 description quality
  C5 safety annotations   C6 liveness   C7 returns real content (anti-ghost)
  C8 machine identity   C9 token efficiency   C10 honest errors
  + advisory Claude/ChatGPT directory pre-flight

${bold("Exit codes")}  0 = grade A/B · 1 = grade C/D · 2 = usage/connection error
${bold("Flags")}  --json machine-readable · --no-color plain output

Grades reproduce the hosted SaSame MCP Observatory (grade-over-time, signed certs): ${OBSERVATORY}
`);
}

if (has("-h") || has("--help") || !url) {
  help();
  process.exit(url ? 0 : 2);
}

const ok = (b) => (b ? C("32", "PASS") : C("31", "FAIL"));

(async () => {
  let a;
  try {
    a = await auditServer(url);
  } catch (e) {
    console.error(C("31", "audit error: ") + String(e && e.message || e));
    process.exit(2);
  }

  if (asJson) {
    console.log(JSON.stringify(a, null, 2));
    process.exit(a.grade === "A" || a.grade === "B" ? 0 : 1);
  }

  const g = a.grade;
  const banner = noColor ? `[ ${g} ]` : `\x1b[${gradeColor[g] || "37"};1m  ${g}  \x1b[0m`;
  console.log("");
  console.log(`  ${bold("MCP Readiness")}  ${banner}  ${bold(a.passes + "/" + a.total)} criteria  ${dim("·")}  ${a.tool_count} tools  ${dim("·")}  ${a.latency_ms}ms`);
  console.log(`  ${dim(a.subject)}`);
  if (a.honesty_cap) console.log(`  ${C("33", "note: " + a.honesty_cap)}`);
  console.log("");
  for (const cr of a.criteria) {
    console.log(`  ${ok(cr.pass)}  ${bold(cr.id)} ${cr.name}`);
    if (!cr.pass) console.log(`        ${dim(cr.evidence)}`);
  }
  console.log("");
  const fails = a.criteria.filter((x) => !x.pass);
  if (fails.length) {
    console.log(`  ${bold("Top fix")}  ${a.top_gap}`);
  } else {
    console.log(`  ${C("32", "Passes every criterion. ")}`);
  }
  // directory pre-flight (advisory)
  const pf = a.preflight;
  if (pf && pf.checks && pf.checks.length) {
    const blockers = pf.checks.filter((c) => c.pass === false);
    if (blockers.length) {
      console.log(`  ${bold("Directory pre-flight")}  ${C("33", blockers.length + " mechanical blocker(s) for Claude/ChatGPT listing")}`);
      for (const b of blockers) console.log(`        ${dim(b.id + " " + b.name + ": " + b.evidence)}`);
    }
  }
  console.log("");
  console.log(`  ${dim("Reproduce / track grade over time at the SaSame MCP Observatory:")}`);
  console.log(`  ${dim(OBSERVATORY + "  (free, no key)")}`);
  console.log(`  ${dim("Think a check is wrong or unfair to your server? We'd genuinely like to be")}`);
  console.log(`  ${dim("corrected — open an issue: " + REPO + "/issues")}`);
  console.log("");
  process.exit(g === "A" || g === "B" ? 0 : 1);
})();
