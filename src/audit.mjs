// mcp-audit — standalone MCP server readiness auditor (MIT).
// 10 spec/measurement-bound criteria (C1..C10) + an advisory directory pre-flight.
// Ported from the SaSame MCP Observatory's canonical engine so a local audit reproduces
// the same per-criterion grade you'd get from the hosted Observatory. No signing, no keys,
// no telemetry — plain `fetch` to the target you name. Node >= 18 (built-in fetch/AbortSignal).

const SPEC = { mcp: "2025-11-25", registry_schema: "2025-09-29" };

// ── transport: one MCP JSON-RPC call over streamable-http (SSE or plain JSON), session-aware ──
async function mcp(url, method, params, sessionId, isNotification, { timeoutMs = 9000 } = {}) {
  const h = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "user-agent": "mcp-audit/0.1",
    "mcp-protocol-version": SPEC.mcp,
  };
  if (sessionId) h["mcp-session-id"] = sessionId; // forward session for STATEFUL servers (else tools/list 400s)
  const msg = { jsonrpc: "2.0", method, params: params || {} };
  if (!isNotification) msg.id = 1;
  let r, rawBody = "";
  try {
    r = await fetch(url, { method: "POST", headers: h, body: JSON.stringify(msg), signal: AbortSignal.timeout(timeoutMs) });
    rawBody = await r.text();
  } catch (e) {
    return { status: 0, json: null, raw: "", sessionId: null, fetchError: String(e && e.message || e) };
  }
  let json = null;
  // streamable-http answers as SSE (data: {...}, joined across data: lines) OR plain JSON
  const dataLines = rawBody.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
  if (dataLines.length) { try { json = JSON.parse(dataLines.join("")); } catch (_) {} }
  if (!json) { try { json = JSON.parse(rawBody.trim()); } catch (_) {} }
  if (!json) { const m = rawBody.match(/\{[\s\S]*\}/); if (m) { try { json = JSON.parse(m[0]); } catch (_) {} } }
  return { status: r.status, json, raw: rawBody, sessionId: r.headers.get("mcp-session-id") || null };
}

// ── the standard: 10 criteria, each bound to spec / measurement (not taste) ──
export const STANDARD = [
  { id: "C1", name: "Protocol handshake conformance", from: "MCP spec " + SPEC.mcp + " — JSON-RPC 2.0 initialize MUST return protocolVersion + capabilities" },
  { id: "C2", name: "Tool listability", from: "MCP spec /server/tools — tools/list MUST return result.tools[]" },
  { id: "C3", name: "Tool object validity", from: "valid name + non-empty description + a TYPED inputSchema (type:object or declared properties)" },
  { id: "C4", name: "Description sufficiency / selectability", from: "every description >=12 chars, median >=20, distinctness ratio >=0.6 (templated/duplicate descriptions are unselectable)" },
  { id: "C5", name: "Safety annotation presence", from: "MCP ToolAnnotations — a valid boolean hint (readOnly/destructive/idempotent/openWorld) on >=50% of tools" },
  { id: "C6", name: "Liveness & latency", from: "2xx initialize within <5000ms" },
  { id: "C7", name: "Returns real content (anti-ghost)", from: "a SAFE (read-only) tool returns substantive MCP content[] (non-echo); priced/x402 -> UNVERIFIED" },
  { id: "C8", name: "Machine-discoverable identity", from: "Official MCP Registry server.json " + SPEC.registry_schema + " — name/version self-description (serverInfo)" },
  { id: "C9", name: "Token efficiency", from: "total tools/list payload bytes (token-bloat is a known ecosystem failure)" },
  { id: "C10", name: "Honest error behavior", from: "JSON-RPC 2.0: malformed/unknown method returns a structured error, not a hang/crash" },
];

function gradeFrom(passes, capped) {
  const total = STANDARD.length;
  let g = passes >= total ? "A" : passes >= total - 2 ? "B" : passes >= total - 5 ? "C" : "D";
  if (capped && g === "A") g = "B"; // honesty cap: no verified real content -> max B
  return g;
}

// ── advisory directory pre-flight (Claude Connectors + ChatGPT Apps mechanical reject reasons) ──
const PF_PROMO = ["best", "official", "pickme", "ultimate", "amazing", "revolutionary", "worlds", "number1", "perfect", "supreme", "premium", "pro_max"];
const PF_GENERIC = new Set(["helper", "main", "util", "utils", "tool", "tools", "do", "run", "go", "handler", "function", "main_function", "test", "misc", "stuff", "thing", "data", "api"]);
function directoryPreflight(tools, init) {
  const out = { advisory: "Maps to MECHANICAL directory reject reasons (Claude Connectors + ChatGPT Apps). Does NOT verify privacy-policy content, identity/business verification, OAuth, or prohibited-category rules. A clean pre-flight is NOT a guarantee of approval.", checks: [] };
  if (!tools || !tools.length) { out.checks.push({ id: "PF1", name: "annotation completeness", pass: null, evidence: "no tools to check" }); out.summary = "no tools — pre-flight n/a"; return out; }
  const miss = tools.filter((t) => { const a = t.annotations || {}; const okTitle = typeof a.title === "string" && a.title.trim().length > 0; const okRW = typeof a.readOnlyHint === "boolean" || typeof a.destructiveHint === "boolean"; return !(okTitle && okRW); }).map((t) => t.name);
  out.checks.push({ id: "PF1", name: "annotation completeness (title + readOnly|destructive on EVERY tool)", pass: miss.length === 0, evidence: miss.length === 0 ? ("all " + tools.length + " tools carry title + a read/destructive hint") : ((tools.length - miss.length) + "/" + tools.length + " ok; missing on: " + miss.slice(0, 8).join(", ") + (miss.length > 8 ? " …" : "")), maps_to: "Claude: every tool needs a title and either readOnlyHint or destructiveHint (~30% of rejects)." });
  const flagged = [];
  for (const t of tools) { const n = String(t.name || "").toLowerCase(); const compact = n.replace(/[^a-z0-9]/g, ""); if (PF_PROMO.some((x) => compact.includes(x.replace(/[^a-z0-9]/g, "")))) flagged.push(t.name + " (promotional)"); else if (PF_GENERIC.has(n)) flagged.push(t.name + " (generic)"); }
  out.checks.push({ id: "PF2", name: "specific, non-promotional tool names", pass: flagged.length === 0, evidence: flagged.length === 0 ? ("no promotional/generic names across " + tools.length + " tools") : ("flagged: " + flagged.slice(0, 8).join(", ") + (flagged.length > 8 ? " …" : "")), maps_to: "ChatGPT: avoid misleading/promotional/comparative language; generic single-word names may be rejected." });
  const r = (init && init.json && init.json.result) || {};
  const blob = (String(r.instructions || "") + " " + JSON.stringify(r.serverInfo || {})).toLowerCase();
  const sig = /privacy/.test(blob) && /https?:\/\//.test(blob);
  out.checks.push({ id: "PF3", name: "privacy-policy signal on MCP surface (soft)", pass: sig ? true : null, evidence: sig ? "server references a privacy policy URL" : "no privacy-policy URL on the MCP surface — both directories REQUIRE a privacy policy in your public docs regardless. Treat as a reminder, not a fail.", maps_to: "Claude: missing/incomplete privacy policy = immediate rejection." });
  const hard = out.checks.filter((c) => c.pass === false).length;
  out.summary = hard === 0 ? "no MECHANICAL pre-flight blockers detected (advisory; not a directory approval)" : (hard + " mechanical pre-flight blocker(s) — fix before submitting");
  return out;
}

// ── the audit: returns {grade, passes, total, criteria[], top_gap, preflight, ...} ──
export async function auditServer(url) {
  const t0 = Date.now();
  const init = await mcp(url, "initialize", { protocolVersion: SPEC.mcp, capabilities: {}, clientInfo: { name: "mcp-audit", version: "0.1" } });
  const latency_ms = Date.now() - t0;
  const sid = init.sessionId;
  try { await mcp(url, "notifications/initialized", {}, sid, true); } catch (_) {}
  const tl = await mcp(url, "tools/list", {}, sid);
  const ev = {}, c = {};

  const initOk = !!(init.json && init.json.result && init.json.result.protocolVersion && init.json.result.capabilities);
  c.C1 = initOk; ev.C1 = "initialize result keys: " + (init.json && init.json.result ? Object.keys(init.json.result).join(",") : "(none, status " + init.status + (init.fetchError ? ", " + init.fetchError : "") + ")");

  const tools = (tl.json && tl.json.result && Array.isArray(tl.json.result.tools)) ? tl.json.result.tools : null;
  c.C2 = !!tools; ev.C2 = tools ? (tools.length + " tools") : "no result.tools[] (status " + tl.status + ")";

  const NAME = /^[A-Za-z0-9_-]{1,128}$/;
  const schemaTyped = (sc) => !!(sc && typeof sc === "object" && !Array.isArray(sc) && (sc.type === "object" || (sc.properties && typeof sc.properties === "object")));
  const c3typed = tools ? tools.filter((x) => x && schemaTyped(x.inputSchema)).length : 0;
  c.C3 = !!(tools && tools.length && tools.every((x) => x && NAME.test(String(x.name || "")) && String(x.description || "").trim().length > 0 && schemaTyped(x.inputSchema)));
  ev.C3 = tools ? (c3typed + "/" + tools.length + " tools: valid name + non-empty desc + typed inputSchema") : "n/a";

  let descOk = false;
  if (tools && tools.length) {
    const ds = tools.map((x) => String(x.description || "").trim());
    const lens = ds.map((d) => d.length).sort((a, b) => a - b);
    const median = lens.length ? lens[Math.floor((lens.length - 1) / 2)] : 0;
    const uniq = new Set(ds).size; const distinctRatio = uniq / ds.length;
    const nonEmpty = ds.filter((d) => d.length >= 12).length;
    descOk = nonEmpty === ds.length && median >= 20 && distinctRatio >= 0.6;
    ev.C4 = nonEmpty + "/" + ds.length + " desc >=12 chars, median " + median + ", distinct " + uniq + "/" + ds.length + " (" + distinctRatio.toFixed(2) + ")";
  } else ev.C4 = "n/a";
  c.C4 = descOk;

  const HINTS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];
  const annValid = tools ? tools.filter((x) => x && x.annotations && typeof x.annotations === "object" && HINTS.some((k) => typeof x.annotations[k] === "boolean")).length : 0;
  c.C5 = !!(tools && tools.length && (annValid / tools.length) >= 0.5);
  ev.C5 = tools ? (annValid + "/" + tools.length + " tools carry a valid safety-hint annotation") : "n/a";

  c.C6 = (init.status >= 200 && init.status < 300) && latency_ms < 5000; ev.C6 = "init status " + init.status + ", latency " + latency_ms + "ms (bar: 2xx & <5000ms)";

  // C7 returns real content (anti-ghost). Safety-first: only invoke read-only tools; empty args first, then
  // minimal valid args on a required-arg signal; multi-tool sample (pass if ANY read-only tool is substantive).
  let realContent = false, deliveryNote = "not tested";
  const buildMinArgs = (schema) => {
    const out = {}; const req = (schema && Array.isArray(schema.required)) ? schema.required : [];
    const props = (schema && schema.properties) || {};
    for (const k of req) { const t = (props[k] && props[k].type) || "string"; out[k] = (t === "number" || t === "integer") ? 1 : t === "boolean" ? true : t === "array" ? [] : t === "object" ? {} : "test"; }
    return out;
  };
  const substantive = (result, argsStr) => {
    if (!result || typeof result !== "object" || result.isError === true) return false;
    let text = "";
    if (Array.isArray(result.content)) for (const it of result.content) { if (it && (it.text || it.data || it.resource || it.type === "image")) text += " " + (it.text || it.data || JSON.stringify(it.resource || it.type)); }
    if (!text && result.structuredContent) text = JSON.stringify(result.structuredContent);
    const stripped = String(text).replace(/[\s"{}\[\]:,]/g, "");
    if (stripped.length <= 24) return false;
    if (argsStr && argsStr.length > 8 && text.trim() === argsStr.trim()) return false;
    return true;
  };
  if (tools && tools.length) {
    const isPaid = (r) => /402|payment required|x402|paywall/i.test(r.raw || "");
    const isTransientCode = (code) => code === -32603 || (typeof code === "number" && code <= -32000 && code >= -32099);
    const roTools = tools.filter((x) => x.annotations && x.annotations.readOnlyHint === true);
    const isRo = roTools.length > 0;
    const MAX_PROBES = 3;
    const candidates = isRo ? roTools.slice(0, MAX_PROBES) : [tools[0]];
    const probeOne = async (probe) => {
      let ok = false, note = "not tested";
      for (let attempt = 0; attempt < 2; attempt++) {
        let transient = false, lastArgsStr = "{}";
        try {
          let call = await mcp(url, "tools/call", { name: probe.name, arguments: {} }, sid);
          if (isPaid(call)) { note = "delivery UNVERIFIED (priced/x402 — not paid)"; }
          else {
            let res = call.json && call.json.result;
            const needsArgs = !!((call.json && call.json.error) || (res && res.isError === true));
            if (isRo && needsArgs && probe.inputSchema && Array.isArray(probe.inputSchema.required) && probe.inputSchema.required.length) {
              const args = buildMinArgs(probe.inputSchema); lastArgsStr = JSON.stringify(args);
              call = await mcp(url, "tools/call", { name: probe.name, arguments: args }, sid);
              if (isPaid(call)) { note = "delivery UNVERIFIED (priced/x402 — not paid)"; res = null; }
              else res = call.json && call.json.result;
            }
            if (note.startsWith("delivery UNVERIFIED")) { /* keep */ }
            else if (call.json && call.json.error) {
              note = "JSON-RPC error " + (call.json.error.code || "") + (isRo ? " (even with minimal valid args)" : " (needs args; safety undeclared, not fabricated)");
              if (isTransientCode(call.json.error.code)) transient = true;
            }
            else if (substantive(res, lastArgsStr)) { ok = true; note = "verified: substantive MCP content[] from " + (isRo ? "read-only tool '" : "tool '") + probe.name + "'"; }
            else if (!call.json || (call.status && call.status >= 500)) { note = "no/invalid response (status " + call.status + ")"; transient = true; }
            else if (res && res.isError === true) {
              note = isRo
                ? "UNVERIFIED — read-only tool '" + probe.name + "' rejected synthetic args (validation/no-match, not a ghost)"
                : "UNVERIFIED — no readOnlyHint tool to safely probe (validation is not a ghost; declare safety hints to enable content verification)";
            }
            else if (lastArgsStr !== "{}") {
              note = "UNVERIFIED — read-only tool '" + probe.name + "' returned trivial/empty output to synthetic args (may reflect trivial input, not a ghost)";
            }
            else { note = "empty/echo/placeholder (no substantive content[])"; }
          }
        } catch (e) { note = "call failed: " + String(e).slice(0, 60); transient = true; }
        if (ok || !transient || attempt === 1) break;
        await new Promise((r) => setTimeout(r, 600));
      }
      return { ok, note };
    };
    let bestNote = "not tested";
    for (let i = 0; i < candidates.length; i++) {
      const r = await probeOne(candidates[i]);
      if (r.ok) { realContent = true; deliveryNote = r.note + (candidates.length > 1 ? " (sampled " + (i + 1) + "/" + candidates.length + " read-only tools)" : ""); break; }
      if (bestNote === "not tested" || /UNVERIFIED|empty\/echo|placeholder|JSON-RPC/.test(r.note)) bestNote = r.note;
    }
    if (!realContent) deliveryNote = bestNote + (candidates.length > 1 ? " (sampled " + candidates.length + " read-only tools, none substantive)" : "");
  }
  c.C7 = realContent; ev.C7 = deliveryNote;

  const si = init.json && init.json.result && init.json.result.serverInfo;
  c.C8 = !!(si && String(si.name || "").trim() && String(si.version || "").trim()); ev.C8 = si ? ("serverInfo: " + si.name + " " + (si.version || "(no version)")) : "no serverInfo";

  const bytes = tl.raw ? tl.raw.length : 0; c.C9 = bytes > 0 && bytes < 40000; ev.C9 = "tools/list payload " + bytes + " bytes";

  const bad = await mcp(url, "this/method/does/not/exist", {}, sid);
  c.C10 = !!(bad.json && bad.json.error && typeof bad.json.error === "object"); ev.C10 = bad.json && bad.json.error ? ("structured error code " + (bad.json.error.code)) : "no structured error";

  const passes = STANDARD.filter((s) => c[s.id] === true).length;
  const grade = gradeFrom(passes, !realContent);
  const criteria = STANDARD.map((s) => ({ id: s.id, name: s.name, pass: c[s.id] === true, evidence: ev[s.id], derived_from: s.from }));
  const fails = criteria.filter((x) => !x.pass);
  return {
    subject: url, audited_at: new Date().toISOString(), latency_ms, tool_count: tools ? tools.length : 0,
    passes, total: STANDARD.length, grade, honesty_cap: !realContent ? "no verified real content -> grade capped at B" : null,
    delivery: deliveryNote, criteria,
    top_gap: fails.length ? (fails[0].id + " " + fails[0].name + " — " + fails[0].evidence) : "none (passes all checks)",
    preflight: directoryPreflight(tools, init),
  };
}
