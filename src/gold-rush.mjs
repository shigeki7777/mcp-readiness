// src/gold-rush.mjs — Gold Rush v1 handoff mode for the mcp-readiness CLI.
// ----------------------------------------------------------------------------
// A lightweight, ZERO-DEPENDENCY client over SaSame's public MCP endpoint. It POSTs a
// single JSON-RPC tools/call — the SaSame public MCP is stateless, so no initialize
// handshake is required — and reads the SSE or JSON response.
//
// Measurement-only, no payment: these commands never trigger live settlement, DNS,
// wallet publication, external account creation, legal, or KYC actions. This module
// reads NO tokens/secrets and sends NO credentials — the public surface needs no key.
// ----------------------------------------------------------------------------

export const DEFAULT_ENDPOINT = "https://live-vps.sasame.online/public-mcp";
export const METHODOLOGY = "https://live-vps.sasame.online/observatory/methodology.html";

export const GR_COMMANDS = {
  start:  { tool: "gold_rush_start",          needs: "mcp-url",    describe: "create or identify a Gold Rush package for an MCP URL" },
  status: { tool: "gold_rush_package_status", needs: "package-id", describe: "read append-only package state" },
  run:    { tool: "gold_rush_agent_run",      needs: "package-id", describe: "advance the package one deterministic safe step (no payment)" },
  report: { tool: "gold_rush_report",         needs: "package-id", describe: "produce the Visibility Report" },
};

export function buildArgs(sub, value, opts = {}) {
  if (sub === "start") {
    const a = { mcp_url: value };
    if (opts.goal) a.goal = opts.goal;
    return a;
  }
  return { package_id: value };
}

// Streamable HTTP may answer as SSE ("data: {...}") or plain JSON — return the JSON object.
function parseRpc(text) {
  const line = text.includes("data:")
    ? (text.split("\n").filter((l) => l.startsWith("data:")).pop() || "").slice(5).trim()
    : text;
  try { return JSON.parse(line || text); } catch { return null; }
}

export async function callTool(name, args, { endpoint = DEFAULT_ENDPOINT, timeoutMs = 20000, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } }),
      signal: ctrl.signal,
    });
  } finally { clearTimeout(timer); }
  const text = await res.text();
  const rpc = parseRpc(text);
  if (!rpc) throw new Error(`unparseable response from ${endpoint} (HTTP ${res.status})`);
  if (rpc.error) throw new Error(rpc.error.message || "MCP error");
  const content = rpc.result && Array.isArray(rpc.result.content) ? rpc.result.content : [];
  const payload = content.filter((c) => c && c.type === "text").map((c) => c.text).join("");
  let data = null; try { data = JSON.parse(payload); } catch { data = null; }
  return { data, text: payload };
}

export async function runGoldRush(sub, value, opts = {}) {
  const cmd = GR_COMMANDS[sub];
  if (!cmd) { const e = new Error(`unknown gold-rush command: ${sub || "(none)"}. Use start | status | run | report.`); e.usage = true; throw e; }
  if (!value) { const e = new Error(`gold-rush ${sub} requires a <${cmd.needs}>`); e.usage = true; throw e; }
  const args = buildArgs(sub, value, opts);
  const { data, text } = await callTool(cmd.tool, args, opts);
  return { command: sub, tool: cmd.tool, args, data, text };
}

// Human-readable render. `color` is an optional (code, str) => str colorizer.
export function renderGoldRush(result, { color } = {}) {
  const C = color || ((_c, s) => s);
  const d = result.data || {};
  const L = ["", `  ${C("1", "Gold Rush")} · ${C("1", result.command)}  ${d.stage_label ? C("36", "[" + d.stage_label + "]") : ""}`];
  if (d.package_id) L.push(`  package_id  ${d.package_id}`);
  if (d.mcp_id) L.push(`  mcp_id      ${d.mcp_id}`);
  if (d.preset) L.push(`  preset      ${d.preset}${d.availability ? " (" + d.availability + ")" : ""}`);
  if (typeof d.done === "boolean") L.push(`  done        ${d.done}`);
  if (Array.isArray(d.required_authorization_scopes)) L.push(`  scopes      ${d.required_authorization_scopes.join(", ")}`);
  if (d.next_action) L.push(`  next        ${d.next_action.tool}${d.next_action.does ? " → " + d.next_action.does : ""}  ${JSON.stringify(d.next_action.args || {})}`);
  const r = d.report;
  if (r) {
    if (r.runtime_health) L.push(`  runtime     reachable=${r.runtime_health.mcp_reachable} tools=${r.runtime_health.tool_count ?? "n/a"} schema=${r.runtime_health.schema_parseable}`);
    if (r.tool_readability) L.push(`  readability ${r.tool_readability.with_description}/${r.tool_readability.tool_count} described (${r.tool_readability.description_coverage_pct}%)`);
    if (r.receipts) L.push(`  receipt     ${r.receipts.receipt_id}`);
    if (Array.isArray(r.known_limitations)) r.known_limitations.forEach((x) => L.push(`  limit       ${C("2", x)}`));
  }
  if (d.paused) L.push(`  ${C("33", "paused: " + (d.message || d.control))}`);
  if (d.error) L.push(`  ${C("31", "error: " + d.error)}`);
  L.push("", `  ${C("2", "Measurement record, not endorsement. Claim status, not identity/KYC. Runtime health, not security verdict. Receipt, not fiscal invoice.")}`);
  L.push(`  ${C("2", "No payment: never triggers live settlement, DNS, wallet, account, legal, or KYC.")}`);
  L.push(`  ${C("2", "Methodology: " + METHODOLOGY)}`, "");
  return L.join("\n");
}
