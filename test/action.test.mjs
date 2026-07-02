import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const message = JSON.parse(body || "{}");
  let result;
  if (message.method === "initialize") {
    result = { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } };
  } else if (message.method === "tools/list") {
    result = { tools: [{ name: "status_check", description: "Return the current fixture service status", inputSchema: { type: "object", properties: {} }, annotations: { title: "Check status", readOnlyHint: true } }] };
  } else if (message.method === "tools/call") {
    result = { content: [{ type: "text", text: "fixture service is operational" }] };
  } else if (message.method === "notifications/initialized") {
    response.writeHead(202).end();
    return;
  } else {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } }));
    return;
  }
  response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "fixture-session" });
  response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const dir = await mkdtemp(join(tmpdir(), "mcp-readiness-action-"));
const summary = join(dir, "summary.md");
const output = join(dir, "output.txt");
const report = join(dir, "report.json");
const child = spawn(process.execPath, [new URL("../bin/action.mjs", import.meta.url).pathname], {
  env: { ...process.env, SASAME_MCP_ENDPOINT: `http://127.0.0.1:${port}/mcp`, SASAME_MIN_GRADE: "B", SASAME_REPORT_PATH: report, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output },
});
let stdout = "", stderr = "";
child.stdout.on("data", (chunk) => stdout += chunk);
child.stderr.on("data", (chunk) => stderr += chunk);
const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
const status = await new Promise((resolve) => child.on("close", resolve));
clearTimeout(timer);
server.close();

assert.equal(status, 0, stderr + stdout);
assert.match(await readFile(summary, "utf8"), /SaSame MCP Readiness: [AB]/);
assert.match(await readFile(summary, "utf8"), /status_check|10\/10 criteria/);
assert.match(await readFile(output, "utf8"), /grade=[AB]/);
const parsed = JSON.parse(await readFile(report, "utf8"));
assert.equal(parsed.subject, `http://127.0.0.1:${port}/mcp`);
console.log("action fixture: ok");
