// mcp-audit — standalone MCP server readiness auditor (MIT).
// 10 spec/measurement-bound criteria (C1..C10) + an advisory directory pre-flight.
// Ported from the SaSame MCP Observatory's canonical engine so a local audit reproduces
// the same per-criterion grade you'd get from the hosted Observatory. No signing, no keys,
// no telemetry — plain `fetch` to the target you name. Node >= 18 (built-in fetch/AbortSignal).
import { negotiateMcpEra, followupRequestContext } from "./mcp-era-negotiation.mjs";

const SPEC = { mcp: "2026-07-28", legacy_fallback: "2025-11-25", registry_schema: "2025-12-11" };
export const STANDARD_VERSION = "agent-tool-discoverability-standard/0.4";
const PINNED_PROTOCOL = SPEC.legacy_fallback; // legacy-only fallback for callers without an explicit revision

// Mirrors the canonical Observatory engine's own modern routing-header requirement: a request whose
// body carries the modern _meta.protocolVersion envelope (server/discover, and any post-negotiation
// call after a modern entry) must also carry Mcp-Method (and Mcp-Name for these three methods) or a
// server implementing that convention rejects with JSON-RPC -32020 "Header mismatch". Discovered by
// running this exact CLI, from a clean install, against SaSame's own production public-mcp server
// (https://live-vps.sasame.online/public-mcp) — the modern entry hard-failed there until this was
// added. Sending these two headers unconditionally is harmless against every other server: a request
// without the modern envelope is never checked against them.
const MODERN_NAMED_METHODS = new Set(["tools/call", "prompts/get", "resources/read"]);

// ── transport: one MCP JSON-RPC call over streamable-http (SSE or plain JSON), session-aware ──
async function mcp(url, method, params, sessionId, isNotification, { timeoutMs = 9000, protocolVersion, requestMeta } = {}) {
  const h = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "user-agent": "mcp-audit/0.2",
    "mcp-protocol-version": protocolVersion || PINNED_PROTOCOL,
  };
  if (sessionId) h["mcp-session-id"] = sessionId; // forward session for STATEFUL servers (else tools/list 400s)
  h["mcp-method"] = method;
  if (MODERN_NAMED_METHODS.has(method)) {
    const name = params && (params.name ?? params.uri);
    if (typeof name === "string" && name) h["mcp-name"] = name;
  }
  // Post-negotiation calls after a MODERN entry repeat the per-request _meta envelope (there is no
  // session to carry it instead) — mirrors the canonical engine's own follow-up request shape.
  const msg = {
    jsonrpc: "2.0",
    method,
    params: requestMeta ? { ...(params || {}), _meta: { ...((params || {})._meta || {}), ...requestMeta } } : (params || {}),
  };
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

// TRANSIENT RETRY (same style as the C7 probe's 2-attempt loop): initialize and tools/list get ONE retry
// after ~800ms when a call fails at the NETWORK layer (mcp() returned status 0 / fetchError — a DNS blip,
// connection reset, or timeout). We NEVER retry an HTTP status (a 401/500 is a real measurement, not a
// blip) — so a single ~9s network blip can no longer mark a healthy server dead/failed.
async function mcpWithRetry(url, method, params, sessionId, isNotification, opts) {
  let t0 = Date.now();
  let res = await mcp(url, method, params, sessionId, isNotification, opts);
  if (res.status === 0) { // network-layer failure / timeout only (fetchError); HTTP statuses are real
    await new Promise((r) => setTimeout(r, 800));
    t0 = Date.now();
    res = await mcp(url, method, params, sessionId, isNotification, opts);
  }
  res.latency_ms = Date.now() - t0; // latency of the FINAL attempt only — a retried blip must not fail C6
  return res;
}

// ── the standard: 10 criteria, each bound to spec / measurement (not taste) ──
export const STANDARD = [
  { id: "C1", name: "Protocol entry conformance", from: "MCP " + SPEC.mcp + " server/discover, with revision-aware fallback to legacy initialize" },
  { id: "C2", name: "Tool listability", from: "MCP spec /server/tools — tools/list MUST return result.tools[]" },
  { id: "C3", name: "Tool object validity", from: "valid name + non-empty description + an object inputSchema (type:object, declared properties, OR a bare {} = a valid JSON Schema 'accepts anything' for no-arg tools; missing/null inputSchema rejected)" },
  { id: "C4", name: "Description sufficiency / selectability", from: "every description >=12 chars, median >=20, distinctness ratio >=0.6 (templated/duplicate descriptions are unselectable)" },
  { id: "C5", name: "Safety annotation presence", from: "MCP ToolAnnotations — a valid boolean hint (readOnly/destructive/idempotent/openWorld) on >=50% of tools" },
  { id: "C6", name: "Liveness & latency", from: "successful revision-appropriate protocol entry within <5000ms" },
  { id: "C7", name: "Returns real content (anti-ghost)", from: "a SAFE (read-only) tool returns substantive MCP content[] (non-echo); priced/x402 -> UNVERIFIED" },
  { id: "C8", name: "Machine-discoverable identity", from: "Official MCP Registry server.json " + SPEC.registry_schema + " — name/version self-description (serverInfo)" },
  { id: "C9", name: "Token efficiency", from: "DECODED tools/list result payload bytes (Buffer.byteLength(JSON.stringify(result))) < 40000 (token-bloat is a known ecosystem failure)" },
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

// ── DUAL-STACK PROTOCOL ENTRY (era-negotiation) ────────────────────────────────
// #3597 fixed a DeepWiki-like false negative in the canonical SaSame engine: a modern
// `server/discover` call answering HTTP 400 / JSON-RPC -32600 "Invalid Request" (no structured
// `data.supported` list) was treated as a hard failure and legacy `initialize` was never attempted.
//
// #3607 (independent-audit follow-up): an earlier revision of this CLI vendored a HAND-WRITTEN
// reimplementation of the canonical decision tree, verified only against the canonical module's own
// (non-exhaustive) test suite — and it silently drifted from canonical on branches that suite never
// exercised. The canonical module (packages/capability-runtime/src/lib/mcp-era-negotiation.mjs) has
// ZERO external imports, so this package now vendors it BYTE-FOR-BYTE instead (see
// ./mcp-era-negotiation.mjs — untouched, and test/canonical-parity-guard.test.mjs, which fails the
// moment the two files diverge by even one byte). This also means the bounded legacy-revision ladder
// (LEGACY_FALLBACK_LADDER) now lives INSIDE negotiateMcpEra itself: it calls exchange() up to 3 times
// for "initialize" — DEFAULT_LEGACY_PROTOCOL_REVISION first, then whatever the server advises, then
// the hardcoded ladder — so this CLI's transport glue (auditExchange, below) no longer implements any
// ladder logic of its own; it is one generic per-attempt HTTP call, exactly matching negotiateMcpEra's
// exchange(request, context) contract, whether the method is "server/discover" or "initialize".
export { LEGACY_FALLBACK_LADDER } from "./mcp-era-negotiation.mjs";

function throwOnTransportFailure(res) {
  if (res.status === 0) throw Object.assign(new Error(res.fetchError || "network_error"), {});
  if (res.status === 401 || res.status === 403 || res.status >= 500) {
    throw Object.assign(new Error("mcp_http_" + res.status), { status: res.status });
  }
}

function auditExchange(url, trace) {
  return async function exchange(request, context) {
    const res = await mcpWithRetry(url, request.method, request.params, null, false, { protocolVersion: context.revision });
    trace.lastEntry = res;
    throwOnTransportFailure(res);
    return { response: res.json, sessionId: res.sessionId, status: res.status };
  };
}

export async function auditServer(url) {
  const clientInfo = { name: "mcp-audit", version: "0.2" };
  const trace = { lastEntry: { status: 0, json: null, raw: "", sessionId: null, latency_ms: 0 } };
  const exchange = auditExchange(url, trace);
  const negotiated = await negotiateMcpEra({ clientInfo, exchange });
  const entryOk = negotiated.kind === "modern" || negotiated.kind === "legacy";
  const entry = trace.lastEntry;
  const latency_ms = entry.latency_ms;
  const sid = negotiated.kind === "legacy" ? negotiated.session_id : null;
  const requestContext = entryOk
    ? followupRequestContext(negotiated, { clientInfo })
    : { revision: negotiated.revision || SPEC.mcp, headers: {}, meta: null };
  const postOpts = { protocolVersion: requestContext.revision, requestMeta: requestContext.meta };
  if (negotiated.kind === "legacy") {
    try { await mcp(url, "notifications/initialized", {}, sid, true, postOpts); } catch (_) {}
  }
  const tl = await mcpWithRetry(url, "tools/list", {}, sid, false, postOpts);
  const ev = {}, c = {};

  // negotiateMcpEra reports the actual legacy-revision ladder it walked internally (present whenever
  // entry_method === "initialize", success or failure) — no separate CLI-side tracking needed.
  const offeredNote = negotiated.entry_method === "initialize" && Array.isArray(negotiated.legacy_attempts) && negotiated.legacy_attempts.length > 1
    ? " (offered " + negotiated.legacy_attempts.join(" -> ") + ")"
    : "";
  c.C1 = entryOk;
  ev.C1 = entryOk
    ? negotiated.entry_method + " negotiated " + negotiated.revision + offeredNote + " (" + negotiated.session_model + ")"
    : "protocol entry failed: " + (negotiated.reason || negotiated.kind) + " (status " + entry.status + (entry.fetchError ? ", " + entry.fetchError : "") + ")";

  const tools = (tl.json && tl.json.result && Array.isArray(tl.json.result.tools)) ? tl.json.result.tools : null;
  c.C2 = !!tools; ev.C2 = tools ? (tools.length + " tools") : "no result.tools[] (status " + tl.status + ")";

  // C3 (v0.3): a bare {} is a VALID JSON Schema ("accepts anything"), legitimately emitted for no-arg
  // tools — accepted since v0.3. Missing / null / non-object inputSchema is still rejected.
  const NAME = /^[A-Za-z0-9_-]{1,128}$/;
  const schemaTyped = (sc) => !!(sc && typeof sc === "object" && !Array.isArray(sc) && (sc.type === "object" || (sc.properties && typeof sc.properties === "object") || Object.keys(sc).length === 0));
  // Evidence must name the dimension that actually failed. Before 0.5.0 this printed only the
  // SCHEMA-passing count while labelling it as all three checks, so a server failing purely on the
  // name charset saw "54/54 tools: valid name + non-empty desc + object inputSchema" next to a FAIL.
  const c3bad = tools
    ? {
        name: tools.filter((x) => !(x && NAME.test(String(x.name || "")))),
        desc: tools.filter((x) => !(x && String(x.description || "").trim().length > 0)),
        schema: tools.filter((x) => !(x && schemaTyped(x.inputSchema))),
      }
    : null;
  c.C3 = !!(tools && tools.length && !c3bad.name.length && !c3bad.desc.length && !c3bad.schema.length);
  if (!tools) ev.C3 = "n/a";
  else if (c.C3) ev.C3 = tools.length + "/" + tools.length + " tools: valid name + non-empty desc + object (or bare {}) inputSchema";
  else {
    const sample = (l) => l.slice(0, 3).map((x) => String((x && x.name) || "(unnamed)")).join(", ") + (l.length > 3 ? " …" : "");
    const parts = [];
    if (c3bad.name.length) parts.push(c3bad.name.length + "/" + tools.length + " name not /^[A-Za-z0-9_-]{1,128}$/ (" + sample(c3bad.name) + ")");
    if (c3bad.desc.length) parts.push(c3bad.desc.length + "/" + tools.length + " empty description (" + sample(c3bad.desc) + ")");
    if (c3bad.schema.length) parts.push(c3bad.schema.length + "/" + tools.length + " inputSchema not an object (" + sample(c3bad.schema) + ")");
    ev.C3 = parts.join("; ");
  }

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

  c.C6 = entryOk && latency_ms < 5000; ev.C6 = "entry status " + entry.status + ", latency " + latency_ms + "ms (bar: negotiated & <5000ms)";

  // C7 returns real content (anti-ghost). Safety-first: only invoke read-only tools; empty args first, then
  // minimal valid args on a required-arg signal; multi-tool sample (pass if ANY read-only tool is substantive).
  let realContent = false, deliveryNote = "not tested", c7DeclinedNoRo = false;
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
          let call = await mcp(url, "tools/call", { name: probe.name, arguments: {} }, sid, false, postOpts);
          if (isPaid(call)) { note = "delivery UNVERIFIED (priced/x402 — not paid)"; }
          else {
            let res = call.json && call.json.result;
            const needsArgs = !!((call.json && call.json.error) || (res && res.isError === true));
            if (isRo && needsArgs && probe.inputSchema && Array.isArray(probe.inputSchema.required) && probe.inputSchema.required.length) {
              const args = buildMinArgs(probe.inputSchema); lastArgsStr = JSON.stringify(args);
              call = await mcp(url, "tools/call", { name: probe.name, arguments: args }, sid, false, postOpts);
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
    if (!realContent) {
      deliveryNote = bestNote + (candidates.length > 1 ? " (sampled " + candidates.length + " read-only tools, none substantive)" : "");
      // HONESTY-CAP WORDING (booleans unchanged): when NO tool declares readOnlyHint we DECLINE to
      // content-verify (we never fabricate args for undeclared-safety tools) — that is a declined probe,
      // not a measured ghost. Only a clean empty on a genuine empty-args call keeps the ghost wording;
      // priced/x402 keeps its own UNVERIFIED wording.
      c7DeclinedNoRo = !isRo && !/empty\/echo\/placeholder|priced\/x402/.test(deliveryNote);
    }
  }
  c.C7 = realContent; ev.C7 = deliveryNote;

  const si = negotiated.server_info;
  c.C8 = !!(si && String(si.name || "").trim() && String(si.version || "").trim()); ev.C8 = si ? ("serverInfo: " + si.name + " " + (si.version || "(no version)")) : "no serverInfo";

  // C9 token efficiency (v0.3): measure the DECODED JSON result payload of tools/list — the raw SSE-framed
  // body double-counted `event:`/`data:` framing and mismeasured chunked streams. Threshold unchanged (40000).
  const bytes = (tl.json && tl.json.result) ? Buffer.byteLength(JSON.stringify(tl.json.result)) : 0;
  c.C9 = bytes > 0 && bytes < 40000; ev.C9 = "decoded tools/list result payload " + bytes + " bytes";

  // C10 honest error behavior — ISOLATED: a timeout/hang on the unknown-method probe is exactly the defect
  // C10 measures (hang instead of structured error), so it fails ONLY C10 and never aborts the audit
  // (the error-tolerant transport returns status 0 / fetchError instead of throwing). No retry here:
  // hanging on an unknown method is the measurement, not a blip to smooth over.
  const bad = await mcp(url, "this/method/does/not/exist", {}, sid, false, postOpts);
  c.C10 = !!(bad.json && bad.json.error && typeof bad.json.error === "object");
  ev.C10 = bad.json && bad.json.error ? ("structured error code " + (bad.json.error.code)) : (bad.fetchError ? "no response to unknown method within timeout — hang instead of structured error" : "no structured error");

  const passes = STANDARD.filter((s) => c[s.id] === true).length;
  const grade = gradeFrom(passes, !realContent);
  const criteria = STANDARD.map((s) => ({ id: s.id, name: s.name, pass: c[s.id] === true, evidence: ev[s.id], derived_from: s.from }));
  const fails = criteria.filter((x) => !x.pass);
  const initShim = { json: { result: { serverInfo: si || null, instructions: (entry.json && entry.json.result && entry.json.result.instructions) || null } } };
  return {
    subject: url, audited_at: new Date().toISOString(), latency_ms, tool_count: tools ? tools.length : 0,
    passes, total: STANDARD.length, grade,
    standard_version: STANDARD_VERSION, // self-identifying: which standard produced these booleans
    honesty_cap: !realContent ? (c7DeclinedNoRo ? "content verification declined (no readOnlyHint tool to safely probe) -> grade capped at B" : "no verified real content -> grade capped at B") : null,
    delivery: deliveryNote, criteria,
    top_gap: fails.length ? (fails[0].id + " " + fails[0].name + " — " + fails[0].evidence) : "none (passes all checks)",
    // Additive (non-breaking) since 0.4/0.7: mirrors the canonical dual-stack engine's own fields —
    // which protocol era/method this audit actually negotiated (see #3597 era-negotiation fix above).
    protocol_revision: negotiated.revision || null,
    entry_method: negotiated.entry_method || null,
    session_model: negotiated.session_model || "unknown",
    extensions: negotiated.extensions || [],
    preflight: directoryPreflight(tools, initShim),
  };
}
