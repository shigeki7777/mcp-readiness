// #3607 (second independent-audit round): src/mcp-era-negotiation.mjs is now vendored BYTE-FOR-BYTE
// from the canonical module — not a hand-written reimplementation "verified" only against a
// non-exhaustive shared test suite (the approach that caused the drift the first audit round caught).
// This file has two jobs:
//
//   1. A DETERMINISTIC PARITY GUARD: byte-diff the vendored copy against the canonical source. Any
//      future edit to EITHER file that isn't mirrored to the other fails this test immediately — no
//      behavioral reasoning required, no non-exhaustive test suite to accidentally miss a branch.
//      Skips (does not fail) when the canonical file isn't reachable on disk — e.g. a consumer who
//      installed only the published `mcp-readiness` tarball, which does not ship the monorepo the
//      canonical module lives in. Only meaningful, and only run, from inside this repo checkout.
//
//   2. Spot-checks pinning the CONCRETE divergences the audit flagged in the prior (reimplementation)
//      version are actually gone now that the file is canonical — not because we patched them, but as
//      a structural consequence of vendoring the real thing. These would be redundant with canonical's
//      own test suite in an ideal world; they exist here because the whole point of this round is "the
//      previous round's tests didn't actually prove canonical parity" — so proving it explicitly, once
//      more, costs little and closes the loop.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import {
  classifyDiscoverResponse,
  classifyLegacyInitializeResponse,
  classifyProbeFailure,
  negotiateMcpEra,
} from "../src/mcp-era-negotiation.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDORED_PATH = path.join(HERE, "../src/mcp-era-negotiation.mjs");
// experiments/agent-8004/oss/mcp-audit/test -> up 4 -> repo root -> packages/capability-runtime/...
const CANONICAL_PATH = path.join(HERE, "../../../../../packages/capability-runtime/src/lib/mcp-era-negotiation.mjs");

test("parity guard: vendored module is byte-for-byte identical to the canonical source", () => {
  if (!existsSync(CANONICAL_PATH)) {
    console.log("SKIP parity guard: canonical module not on disk at " + CANONICAL_PATH + " (not running inside the monorepo checkout — expected for a published-tarball consumer).");
    return;
  }
  const canonical = readFileSync(CANONICAL_PATH, "utf8");
  const vendored = readFileSync(VENDORED_PATH, "utf8");
  assert.equal(
    vendored,
    canonical,
    "src/mcp-era-negotiation.mjs has diverged from the canonical module at " + CANONICAL_PATH +
      " — re-sync with: cp " + CANONICAL_PATH + " " + VENDORED_PATH,
  );
});

// ── spot-checks: the concrete points the audit flagged, now provably resolved ────────────────────

test("extensions: an ARRAY-shaped capabilities.extensions is filtered to strings and sorted (not turned into index keys)", () => {
  const result = classifyDiscoverResponse({
    jsonrpc: "2.0",
    id: 1,
    result: {
      resultType: "complete",
      supportedVersions: ["2026-07-28"],
      capabilities: { extensions: ["io.modelcontextprotocol/tasks", "io.modelcontextprotocol/apps"] },
    },
  }, { supportedModernRevisions: ["2026-07-28"] });
  assert.equal(result.kind, "modern");
  assert.deepEqual(result.extensions, ["io.modelcontextprotocol/apps", "io.modelcontextprotocol/tasks"]);
});

test("extensions: legacy initialize success reports extensions too (not omitted)", () => {
  const result = classifyLegacyInitializeResponse({
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2025-11-25",
      capabilities: { extensions: { "io.modelcontextprotocol/apps": {} } },
      serverInfo: { name: "fixture", version: "1.0.0" },
    },
  });
  assert.equal(result.kind, "legacy");
  assert.deepEqual(result.extensions, ["io.modelcontextprotocol/apps"]);
});

test("successful discover: a mutually-supported OLDER modern revision (not the one attempted) is still accepted, not downgraded", () => {
  // The server was asked for 2027-01-01 (the client's first pinned revision) but answers with a
  // supportedVersions list that only overlaps supportedModernRevisions on an older entry — canonical
  // resolves this by consulting supportedModernRevisions itself, not just the single revision string
  // that happened to be sent in this particular request.
  const result = classifyDiscoverResponse({
    jsonrpc: "2.0",
    id: 1,
    result: { resultType: "complete", supportedVersions: ["2026-07-28", "2025-11-25"], capabilities: {} },
  }, { supportedModernRevisions: ["2027-01-01", "2026-07-28"] });
  assert.equal(result.kind, "modern");
  assert.equal(result.revision, "2026-07-28");
});

test("classifyProbeFailure: statusCode (not just status) is honoured for auth/transport classification", () => {
  assert.equal(classifyProbeFailure({ statusCode: 401 }).kind, "authorization_error");
  assert.equal(classifyProbeFailure({ statusCode: 503 }).kind, "transport_error");
});

test("negotiateMcpEra: an empty supportedModernRevisions array is rejected as a TypeError, not silently accepted", async () => {
  await assert.rejects(
    () => negotiateMcpEra({ supportedModernRevisions: [], exchange: async () => ({ jsonrpc: "2.0", id: 1, error: { code: -32601 } }) }),
    TypeError,
  );
});

test("negotiateMcpEra: the legacy ladder lives INSIDE negotiateMcpEra (up to 3 exchange() calls for initialize), not in the caller", async () => {
  const SUPPORTED = ["2024-11-05", "2025-03-26", "2025-06-18"];
  const initializeRevisions = [];
  const result = await negotiateMcpEra({
    exchange: async (request, context) => {
      if (request.method === "server/discover") return { jsonrpc: "2.0", id: 1, error: { code: -32601 } };
      initializeRevisions.push(context.revision);
      if (!SUPPORTED.includes(context.revision)) {
        return { jsonrpc: "2.0", id: 1, error: { code: -32600, message: "Unsupported", data: { supported: SUPPORTED } } };
      }
      return { jsonrpc: "2.0", id: 1, result: { protocolVersion: context.revision, capabilities: {}, serverInfo: null } };
    },
  });
  assert.equal(result.kind, "legacy");
  assert.equal(result.revision, "2025-06-18");
  assert.equal(initializeRevisions[0], "2025-11-25", "first legacy attempt is still the pinned DEFAULT_LEGACY_PROTOCOL_REVISION");
  assert.ok(initializeRevisions.includes("2025-06-18"), "ladder recovers a newer advertised legacy revision");
  assert.deepEqual(result.legacy_attempts, initializeRevisions);
});
