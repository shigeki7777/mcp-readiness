#!/usr/bin/env node
// mcp-readiness CLI — `npx mcp-readiness <url>` grades a public MCP server against 10 readiness criteria.
import { auditServer } from "../src/audit.mjs";
import { runGoldRush, renderGoldRush, DEFAULT_ENDPOINT } from "../src/gold-rush.mjs";

const OBSERVATORY = "https://live-vps.sasame.online/public-mcp";
const REPO = "https://github.com/shigeki7777/mcp-readiness";
const CLAIM = "https://github.com/shigeki7777/sasame-mcp-observatory/issues/new?template=claim-passport.yml";
// Activation: a server can be DISCOVERED (crawled) without ever being CALLED.
// baseline = free, hosted, measurement-only; repair = paid, refund if no baseline.
// (Per-host deep links planned once a host route exists on the Observatory.)
const ACTIVATION = {
  baseline_url: "https://live-vps.sasame.online/observatory/check/",
  repair_url: "https://buy.stripe.com/14A9ATbezeuicyBdED1ZS1p",
  price_usd: 99,
};
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const flagVal = (f) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : null; };
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

${bold("Gold Rush v1 handoff")} (drives SaSame's public MCP — measurement only, no payment, no key)
  npx mcp-readiness gold-rush start <mcp-url> [--goal <preset>]   # create/identify a package
  npx mcp-readiness gold-rush status <package-id>                 # read append-only package state
  npx mcp-readiness gold-rush run <package-id>                    # advance one deterministic safe step
  npx mcp-readiness gold-rush report <package-id>                 # produce the Visibility Report
  (add --json for machine output · --endpoint <url> to target another SaSame public MCP)

${bold("Exit codes")}  0 = grade A/B (or gold-rush ok) · 1 = grade C/D (or tool error) · 2 = usage/connection error
${bold("Flags")}  --json machine-readable · --no-color plain output

Grades reproduce the hosted SaSame MCP Observatory (grade-over-time, signed certs): ${OBSERVATORY}
If this is your MCP, claim the free owner-controlled Passport after the grade: ${CLAIM}
`);
}

// Gold Rush v1 handoff mode (must run BEFORE the url-based audit — `gold-rush start
// <mcp-url>` contains a URL that would otherwise trigger an audit).
if (args[0] === "gold-rush") {
  if (has("-h") || has("--help") || !args[1]) { help(); process.exit(args[1] ? 0 : 2); }
  const sub = args[1];
  // positional value = first non-flag after the subcommand that isn't a --goal/--endpoint value
  const positional = args.slice(2).filter((a, i, arr) => !a.startsWith("-") && !(arr[i - 1] === "--goal" || arr[i - 1] === "--endpoint"));
  const value = positional[0];
  const opts = { goal: flagVal("--goal") || undefined, endpoint: flagVal("--endpoint") || DEFAULT_ENDPOINT };
  try {
    const result = await runGoldRush(sub, value, opts);
    const failed = result.data && result.data.ok === false;
    if (asJson) console.log(JSON.stringify(result.data, null, 2));
    else console.log(renderGoldRush(result, { color: C }));
    process.exit(failed ? 1 : 0);
  } catch (e) {
    console.error(C("31", "gold-rush error: ") + String((e && e.message) || e));
    process.exit(2);
  }
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

  const claimHint = {
    if_this_is_your_server: "Claim the free SaSame MCP Readiness Passport after this local grade.",
    github_claim_template: CLAIM,
    mcp_next_call: "Connect https://live-vps.sasame.online/public-mcp and call claim_start(url) then claim_confirm.",
    boundary: "Owner-controlled readiness record only; not a malware scan, endorsement, paid ranking, custody relationship, or tax document."
  };

  if (asJson) {
    console.log(JSON.stringify({ ...a, claim_hint: claimHint, activation: ACTIVATION }, null, 2));
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
  console.log(`  ${bold("Claim this server")}  ${dim("If this is your MCP, claim the free owner-controlled Passport:")}`);
  console.log(`  ${dim(CLAIM)}`);
  console.log(`  ${dim("Or connect the SaSame public MCP and call claim_start(url) → claim_confirm.")}`);
  console.log("");
  console.log(`  ${bold("Agents may DISCOVER this server without ever CALLING its tools.")}`);
  console.log(`  Free activation baseline ${dim("(observed discovery vs. real tool calls)")}:`);
  console.log(`    ${ACTIVATION.baseline_url}  ${dim("(find your server, or ask via /public-mcp start_here)")}`);
  console.log(`  Paid activation repair ${dim("($99, before/after evidence, refund if no baseline)")}:`);
  console.log(`    ${ACTIVATION.repair_url}`);
  console.log("");
  console.log(`  ${dim("Think a check is wrong or unfair to your server? We'd genuinely like to be")}`);
  console.log(`  ${dim("corrected — open an issue: " + REPO + "/issues")}`);
  console.log("");
  process.exit(g === "A" || g === "B" ? 0 : 1);
})();
