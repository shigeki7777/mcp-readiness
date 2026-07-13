// test/gold-rush.test.mjs — Gold Rush handoff mode. Hermetic: a fixture MCP server
// stands in for SaSame's public MCP (no network). Covers: help includes Gold Rush,
// existing audit mode still works, argument parsing, JSON-mode shape, exit codes, and
// no token/secret leakage.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildArgs, callTool, GR_COMMANDS } from "../src/gold-rush.mjs";

const CLI = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));
const receivedHeaders = [];

// Fixture MCP server: serves both the audit handshake (initialize/tools/list/tools/call)
// and the Gold Rush wrapper tools (returns a public_safe envelope).
const server = createServer(async (req, res) => {
  receivedHeaders.push(req.headers);
  let body = ""; for await (const c of req) body += c;
  const m = JSON.parse(body || "{}");
  const send = (result) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result })); };
  const wrap = (obj) => send({ content: [{ type: "text", text: JSON.stringify(obj) }] });
  if (m.method === "initialize") return send({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } });
  if (m.method === "notifications/initialized") { res.writeHead(202).end(); return; }
  if (m.method === "tools/list") return send({ tools: [{ name: "status_check", description: "Return the current fixture service status", inputSchema: { type: "object", properties: {} }, annotations: { title: "Check status", readOnlyHint: true } }] });
  if (m.method === "tools/call") {
    const name = m.params && m.params.name;
    const a = (m.params && m.params.arguments) || {};
    if (name === "gold_rush_start") return wrap({ ok: true, package_id: "pkg_fixture_1", mcp_id: "mcp_fixture", preset: a.goal || "visibility_check", stage_label: "created", done: false, next_action: { tool: "gold_rush_agent_run", args: { package_id: "pkg_fixture_1" }, does: "observe" }, required_authorization_scopes: ["observe_public_mcp"], measurement_boundary: "Measurement record, not endorsement.", no_payment_boundary: "No payment.", known_limitations: [] });
    if (name === "gold_rush_package_status") {
      if (a.package_id === "pkg_missing") return wrap({ ok: false, package_id: a.package_id, error: "no such package" });
      return wrap({ ok: true, package_id: a.package_id, stage_label: "report_ready", done: true, next_action: { tool: "gold_rush_report", args: { package_id: a.package_id } }, measurement_boundary: "…", no_payment_boundary: "…", known_limitations: ["latest snapshot only"] });
    }
    if (name === "gold_rush_agent_run") return wrap({ ok: true, package_id: a.package_id, step_run: "observe", stage_label: "observed", done: false, next_action: { tool: "gold_rush_agent_run", args: { package_id: a.package_id } }, measurement_boundary: "…", no_payment_boundary: "…", known_limitations: [] });
    if (name === "gold_rush_report") return wrap({ ok: true, package_id: a.package_id, stage_label: "report_ready", done: true, report: { runtime_health: { mcp_reachable: true, tool_count: 1, schema_parseable: true }, tool_readability: { with_description: 1, tool_count: 1, description_coverage_pct: 100 }, receipts: { receipt_id: "grr_fixture" }, known_limitations: ["not a security verdict"], measurement_boundary: "…", no_payment_boundary: "…" }, measurement_boundary: "…", no_payment_boundary: "…", known_limitations: [] });
    return wrap({ ok: true }); // audit C7 anti-ghost call etc.
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } }));
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();
const ENDPOINT = `http://127.0.0.1:${port}/mcp`;

function run(cliArgs, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...cliArgs], { env: { ...process.env, ...env } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    const t = setTimeout(() => child.kill("SIGKILL"), 15000);
    child.on("close", (code) => { clearTimeout(t); resolve({ code, stdout, stderr }); });
  });
}

// 1. help includes Gold Rush commands
{
  const { stdout } = await run(["--help"]);
  for (const c of ["gold-rush start", "gold-rush status", "gold-rush run", "gold-rush report"]) assert.ok(stdout.includes(c), `help includes '${c}'`);
  assert.ok(stdout.includes("measurement only") || stdout.includes("measurement"), "help states measurement boundary");
}

// 2. argument parsing
assert.deepEqual(buildArgs("start", "https://x/mcp", { goal: "quick_claim" }), { mcp_url: "https://x/mcp", goal: "quick_claim" });
assert.deepEqual(buildArgs("start", "https://x/mcp"), { mcp_url: "https://x/mcp" });
assert.deepEqual(buildArgs("status", "pkg_1"), { package_id: "pkg_1" });
assert.deepEqual(Object.keys(GR_COMMANDS).sort(), ["report", "run", "start", "status"]);

// 3. client end-to-end against the fixture (JSON mode shape)
{
  const { data } = await callTool("gold_rush_start", { mcp_url: "https://x/mcp", goal: "visibility_check" }, { endpoint: ENDPOINT });
  for (const k of ["ok", "package_id", "stage_label", "next_action", "done", "measurement_boundary", "no_payment_boundary", "known_limitations"]) assert.ok(k in data, `callTool result has ${k}`);
  assert.equal(data.ok, true);
}

// 4. CLI gold-rush start --json against fixture -> parseable, exit 0
{
  const { code, stdout } = await run(["gold-rush", "start", "https://x/mcp", "--endpoint", ENDPOINT, "--json", "--no-color"]);
  const j = JSON.parse(stdout);
  assert.equal(j.ok, true); assert.equal(j.package_id, "pkg_fixture_1"); assert.equal(code, 0);
}

// 5. exit codes: usage(2), tool-error(1), report(0)
assert.equal((await run(["gold-rush", "start"])).code, 2, "no value -> exit 2");
assert.equal((await run(["gold-rush", "status", "pkg_missing", "--endpoint", ENDPOINT, "--json"])).code, 1, "ok:false -> exit 1");
assert.equal((await run(["gold-rush", "report", "pkg_fixture_1", "--endpoint", ENDPOINT, "--json"])).code, 0, "report -> exit 0");

// 6. existing audit mode still works (against the same fixture)
{
  const { stdout } = await run([ENDPOINT, "--json", "--no-color"]);
  const j = JSON.parse(stdout);
  assert.ok(["A", "B", "C", "D"].includes(j.grade), "audit mode still returns a grade");
  assert.equal(j.subject, ENDPOINT);
}

// 7. activation block (v0.3.1): appears in text + json output, no secrets
{
  const { stdout } = await run([ENDPOINT, "--no-color"]);
  assert.ok(stdout.includes("Agents may DISCOVER this server without ever CALLING its tools."), "activation headline in text output");
  assert.ok(stdout.includes("Free activation baseline"), "free baseline line present");
  assert.ok(stdout.includes("https://live-vps.sasame.online/observatory/check/"), "baseline URL present");
  assert.ok(stdout.includes("refund if no baseline"), "refund rule stated");
  assert.ok(stdout.includes("https://buy.stripe.com/14A9ATbezeuicyBdED1ZS1p"), "repair URL present");
  // no secret material in the printed report (narrow patterns; "Token efficiency" criterion is fine)
  assert.ok(!/(sk_live_|sk_test_|rk_live_|ghp_[A-Za-z0-9]|npm_[A-Za-z0-9]|xox[bp]-|-----BEGIN|authorization:|x-api-key)/i.test(stdout), "activation output contains no secrets");
  const { stdout: js } = await run([ENDPOINT, "--json", "--no-color"]);
  const j = JSON.parse(js);
  assert.ok(j.activation, "--json output has activation object");
  assert.equal(j.activation.baseline_url, "https://live-vps.sasame.online/observatory/check/");
  assert.equal(j.activation.repair_url, "https://buy.stripe.com/14A9ATbezeuicyBdED1ZS1p");
  assert.equal(j.activation.price_usd, 99);
}

// 8. no token/secret leakage
{
  const client = readFileSync(fileURLToPath(new URL("../src/gold-rush.mjs", import.meta.url)), "utf8");
  const both = client + readFileSync(CLI, "utf8");
  // neither the client nor the CLI reads a secret env var
  assert.ok(!/process\.env\.[A-Za-z_]*(TOKEN|SECRET|APIKEY|API_KEY|BEARER|PASSWORD|NPM|AUTH)/i.test(both), "reads no secret env var");
  // the client that makes the request has no auth header / bearer / api-key
  assert.ok(!/\bauthorization\b|x-api-key|\bbearer\b/i.test(client), "client source has no auth header");
  // behavioral proof: the fixture (hit by tests 3-6) never received an auth header
  const sawAuth = receivedHeaders.some((h) => h.authorization || h["x-api-key"]);
  assert.equal(sawAuth, false, "fixture received no Authorization/x-api-key header");
}

server.close();
console.log("gold-rush handoff: ok");
