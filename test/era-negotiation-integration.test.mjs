// Integration-level regression for #3597's DeepWiki-like false negative, exercised through the real
// auditServer() entry point (not just the unit-level mcp-era-negotiation.test.mjs suite ported into
// this package). Two live HTTP fixtures:
//
//   1. deepwiki-like: implements ONLY legacy `initialize`. Any other method — including the modern
//      `server/discover` this CLI now tries first — answers HTTP 400 / JSON-RPC -32600 "Invalid
//      Request" with NO structured `data.supported` list (the exact DeepWiki shape). Before this
//      fix, that exact 400/-32600 response would never have been produced by this CLI in the first
//      place (it never spoke server/discover) OR, once dual-stack negotiation is added naively,
//      could be mishandled as a hard failure instead of falling back to `initialize`. This pins
//      that it correctly falls back and grades the server on its merits.
//
//   2. modern-only: implements ONLY the modern `server/discover` entry (no `initialize` at all) —
//      a server class this CLI could not grade before this change (it never sent server/discover).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { auditServer } from "../src/audit.mjs";

function send(response, payload, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function makeDeepWikiLikeServer() {
  return createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const message = JSON.parse(body || "{}");
    if (message.method === "server/discover") {
      // #3597 exact shape: 400 + JSON-RPC -32600, no data.supported.
      return send(response, { jsonrpc: "2.0", id: message.id ?? null, error: { code: -32600, message: "Invalid Request" } }, 400);
    }
    if (message.method === "initialize") {
      return send(response, { jsonrpc: "2.0", id: message.id, result: {
        protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "deepwiki-like-fixture", version: "1.0.0" },
      } });
    }
    if (message.method === "notifications/initialized") { response.writeHead(202).end(); return; }
    if (message.method === "tools/list") {
      return send(response, { jsonrpc: "2.0", id: message.id, result: { tools: [
        { name: "repo_summary", description: "Return a summary of the indexed repository contents", inputSchema: { type: "object", properties: {} }, annotations: { title: "Repo summary", readOnlyHint: true } },
      ] } });
    }
    if (message.method === "tools/call") {
      return send(response, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "fixture repo summary: 42 files indexed" }] } });
    }
    return send(response, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
  });
}

function makeModernOnlyServer() {
  return createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const message = JSON.parse(body || "{}");
    if (message.method === "server/discover") {
      return send(response, { jsonrpc: "2.0", id: message.id, result: {
        resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {} },
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "modern-only-fixture", version: "2.0.0" } },
      } });
    }
    if (message.method === "tools/list") {
      return send(response, { jsonrpc: "2.0", id: message.id, result: { tools: [
        { name: "modern_status", description: "Return the current modern-only fixture service status", inputSchema: { type: "object", properties: {} }, annotations: { title: "Status", readOnlyHint: true } },
      ] } });
    }
    if (message.method === "tools/call") {
      return send(response, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "modern fixture service is operational" }] } });
    }
    // No `initialize` implemented at all — a pure modern-era server (this CLI could not grade this
    // class of server before this change: it never attempted server/discover).
    return send(response, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
  });
}

async function withServer(factory, fn) {
  const server = factory();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}/mcp`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// 1. DeepWiki-like 400/-32600 with no structured advice: must fall back to legacy initialize and
//    grade the server honestly (not a hard C1 failure).
await withServer(makeDeepWikiLikeServer, async (url) => {
  const r = await auditServer(url);
  assert.equal(r.criteria.find((c) => c.id === "C1").pass, true, "C1 must pass via legacy fallback after a 400/-32600 discover rejection");
  assert.equal(r.entry_method, "initialize", "must have fallen back to legacy initialize");
  assert.equal(r.protocol_revision, "2025-11-25");
  assert.equal(r.tool_count, 1, "tools/list must be reached after the fallback (was unreachable before this class of fix)");
  assert.notEqual(r.grade, "D", "must not be a false D from the DeepWiki-like discover rejection");
  const c1 = r.criteria.find((c) => c.id === "C1").evidence;
  assert.ok(/initialize negotiated 2025-11-25/.test(c1), "C1 evidence names the negotiated legacy entry: " + c1);
});

// 2. Modern-only server (no `initialize` at all): this CLI could not grade this server class before
//    dual-stack negotiation — it never attempted server/discover and would have hard-failed C1.
await withServer(makeModernOnlyServer, async (url) => {
  const r = await auditServer(url);
  assert.equal(r.criteria.find((c) => c.id === "C1").pass, true, "C1 must pass via the modern server/discover entry");
  assert.equal(r.entry_method, "server/discover");
  assert.equal(r.protocol_revision, "2026-07-28");
  assert.equal(r.session_model, "request_scoped");
  assert.equal(r.tool_count, 1);
  assert.notEqual(r.grade, "D", "a compliant modern-only server must not grade D just for lacking legacy initialize");
});

console.log("PASS era-negotiation-integration: DeepWiki-like 400/-32600 fallback + modern-only server");
