// Regression test for the FALSE GRADE D fixed in 0.5.0.
//
// A server that only speaks pre-2025-11-25 revisions and validates the MCP-Protocol-Version header
// BEFORE routing used to fail C1, never reach tools/list, and cascade-fail to D with "0 tools".
// Fixture reproduces the exact shape observed in the wild (mcp.setix.dev, 2026-07-29): reject an
// unknown revision with JSON-RPC -32600 + data.supported, accept 2025-06-18.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { auditServer, LEGACY_FALLBACK_LADDER } from "../src/audit.mjs";

const SUPPORTED = ["2024-11-05", "2025-03-26", "2025-06-18"];
const offered = [];

function makeServer({ advertiseSupported = true, errorCode = -32600 } = {}) {
  return createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const message = JSON.parse(body || "{}");
    const revision = request.headers["mcp-protocol-version"];
    const send = (payload, status = 200) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    };

    // Header validated before routing — exactly how the real server behaves.
    if (revision && !SUPPORTED.includes(revision)) {
      if (message.method === "initialize") offered.push(revision);
      return send({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: errorCode,
          message: "Unsupported MCP-Protocol-Version",
          ...(advertiseSupported ? { data: { supported: SUPPORTED, requested: revision } } : {}),
        },
      }, 400);
    }

    if (message.method === "initialize") {
      offered.push(revision);
      return send({ jsonrpc: "2.0", id: message.id, result: {
        protocolVersion: revision, capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "legacy-only-fixture", version: "1.0.0" },
      } });
    }
    if (message.method === "notifications/initialized") { response.writeHead(202).end(); return; }
    if (message.method === "tools/list") {
      return send({ jsonrpc: "2.0", id: message.id, result: { tools: [
        { name: "svc.health", description: "Return current fixture service health and version", inputSchema: { type: "object", properties: {} } },
        { name: "svc.lookup", description: "Look up a fixture record by its identifier string", inputSchema: { type: "object", properties: { id: { type: "string" } } } },
      ] } });
    }
    if (message.method === "tools/call") {
      return send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "fixture health: ok, 2 records" }] } });
    }
    return send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
  });
}

async function run(opts) {
  offered.length = 0;
  const server = makeServer(opts);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    return await auditServer(`http://127.0.0.1:${port}/mcp`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// 1. The core regression: advertised list is honoured, handshake succeeds, tools are seen.
{
  const r = await run();
  assert.equal(r.criteria.find((c) => c.id === "C1").pass, true, "C1 must pass via advertised revision");
  assert.equal(r.criteria.find((c) => c.id === "C2").pass, true, "C2 must see tools");
  assert.equal(r.tool_count, 2, "tools/list must be reached (was 0 before 0.5.0)");
  assert.notEqual(r.grade, "D", "must no longer be a false D");
  assert.equal(offered[0], "2025-11-25", "first attempt still offers the pinned revision");
  assert.ok(offered.includes("2025-06-18"), "must retry with the newest advertised revision");
  assert.ok(offered.length <= 3, "bounded to 3 attempts, got " + offered.length);
  const c1 = r.criteria.find((c) => c.id === "C1").evidence;
  assert.ok(/2025-06-18/.test(c1), "C1 evidence names the negotiated revision: " + c1);
  assert.ok(/->/.test(c1), "C1 evidence shows the revisions tried: " + c1);
}

// 2. No advertised list: the hardcoded real-world ladder still recovers the server.
{
  const r = await run({ advertiseSupported: false });
  assert.equal(r.criteria.find((c) => c.id === "C1").pass, true, "ladder must recover a silent rejecter");
  assert.equal(r.tool_count, 2);
  assert.equal(offered[1], LEGACY_FALLBACK_LADDER[0], "ladder is walked newest-first");
}

// 3. A non-standard error code carrying data.supported is still honoured (the real bug: we only
//    recognised -32022, the server sent -32600).
{
  const r = await run({ errorCode: -32022 });
  assert.equal(r.criteria.find((c) => c.id === "C1").pass, true, "spec-suggested code path still works");
  assert.equal(r.tool_count, 2);
}

// 4. C3 evidence must name the dimension that ACTUALLY failed (dotted names here), and must not
//    report a passing count next to a FAIL.
{
  const r = await run();
  const c3 = r.criteria.find((c) => c.id === "C3");
  assert.equal(c3.pass, false, "dotted names fail C3");
  assert.ok(/name not/.test(c3.evidence), "C3 evidence names the charset dimension: " + c3.evidence);
  assert.ok(/svc\.health|svc\.lookup/.test(c3.evidence), "C3 evidence cites offending tools: " + c3.evidence);
  assert.ok(!/valid name \+ non-empty desc/.test(c3.evidence), "must not claim all three checks passed on a FAIL");
}

// 5. An unreachable server is still an honest D — the fallback must not paper over a dead endpoint.
{
  const r = await auditServer("http://127.0.0.1:1/mcp");
  assert.equal(r.grade, "D", "dead endpoint stays D");
  assert.equal(r.criteria.find((c) => c.id === "C1").pass, false);
}

console.log("PASS revision-fallback: 5 scenarios (false-D regression, ladder, error-code agnostic, C3 evidence, dead endpoint)");
