// Verbatim copy of experiments/agent-8004/public-mcp/lib/mcp-era-negotiation.test.mjs (only the
// import path is adjusted), run here against this package's own vendored reimplementation
// (../src/mcp-era-negotiation.mjs) to prove behavioral parity with the canonical module without this
// zero-dep OSS package depending on the private @sasame/capability-runtime workspace package.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  MODERN_PROTOCOL_REVISION,
  classifyDiscoverResponse,
  classifyProbeFailure,
  discoverRequest,
  followupRequestContext,
  negotiateMcpEra,
} from '../src/mcp-era-negotiation.mjs';

const fixtureUrl = new URL('./fixtures/mcp-era-negotiation.json', import.meta.url);
const fixtures = JSON.parse(await readFile(fixtureUrl, 'utf8'));

test('discover request carries the reserved per-request metadata envelope', () => {
  const request = discoverRequest({ clientInfo: { name: 'fixture', version: '1' } });
  assert.equal(request.method, 'server/discover');
  assert.equal(request.params._meta['io.modelcontextprotocol/protocolVersion'], MODERN_PROTOCOL_REVISION);
  assert.deepEqual(request.params._meta['io.modelcontextprotocol/clientInfo'], { name: 'fixture', version: '1' });
  assert.deepEqual(request.params._meta['io.modelcontextprotocol/clientCapabilities'], {});
});

test('2026-only endpoint negotiates modern without initialize', async () => {
  const methods = [];
  const result = await negotiateMcpEra({ exchange: async (request) => {
    methods.push(request.method);
    return fixtures.modern_only.discover;
  } });
  assert.equal(result.kind, 'modern');
  assert.equal(result.revision, '2026-07-28');
  assert.equal(result.entry_method, 'server/discover');
  assert.equal(result.session_model, 'request_scoped');
  assert.deepEqual(result.extensions, ['io.modelcontextprotocol/apps', 'io.modelcontextprotocol/tasks']);
  assert.deepEqual(methods, ['server/discover']);
});

test('legacy-only endpoint falls back and preserves a stateful session', async () => {
  const methods = [];
  const result = await negotiateMcpEra({ exchange: async (request) => {
    methods.push(request.method);
    return request.method === 'server/discover'
      ? fixtures.legacy_only.discover
      : { response: fixtures.legacy_only.initialize, sessionId: fixtures.legacy_only.session_id };
  } });
  assert.equal(result.kind, 'legacy');
  assert.equal(result.entry_method, 'initialize');
  assert.equal(result.session_model, 'stateful');
  assert.equal(result.session_id, 'fixture-session-1');
  assert.equal(result.fallback_from, '2026-07-28');
  assert.deepEqual(methods, ['server/discover', 'initialize']);
});

test('dual-stack endpoint prefers the modern era', async () => {
  const methods = [];
  const result = await negotiateMcpEra({ exchange: async (request) => {
    methods.push(request.method);
    return fixtures.dual_stack.discover;
  } });
  assert.equal(result.kind, 'modern');
  assert.deepEqual(methods, ['server/discover']);
});

test('malformed discovery falls back in auto mode but never passes as modern', async () => {
  assert.equal(
    classifyDiscoverResponse(fixtures.malformed_discovery.discover).reason,
    'invalid_supported_versions',
  );
  const methods = [];
  const result = await negotiateMcpEra({ exchange: async (request) => {
    methods.push(request.method);
    return request.method === 'server/discover'
      ? fixtures.malformed_discovery.discover
      : fixtures.malformed_discovery.initialize;
  } });
  assert.equal(result.kind, 'legacy');
  assert.equal(result.fallback_reason, 'invalid_supported_versions');
  assert.deepEqual(methods, ['server/discover', 'initialize']);
});

test('unsupported modern revision is explicit and can use bounded legacy fallback', async () => {
  const methods = [];
  const result = await negotiateMcpEra({ exchange: async (request) => {
    methods.push(request.method);
    return request.method === 'server/discover'
      ? fixtures.unsupported_revision.discover
      : fixtures.unsupported_revision.initialize;
  } });
  assert.equal(result.kind, 'legacy');
  assert.equal(result.fallback_reason, 'no_mutually_supported_modern_revision');
  assert.deepEqual(methods, ['server/discover', 'initialize']);
});

test('unsupported-version advice gets one bounded mutually supported modern retry', async () => {
  const revisions = [];
  const result = await negotiateMcpEra({
    supportedModernRevisions: ['2027-01-01', '2026-07-28'],
    exchange: async (request, context) => {
      revisions.push(context.revision);
      return context.revision === '2027-01-01'
        ? fixtures.corrective_revision.unsupported
        : fixtures.corrective_revision.discover;
    },
  });
  assert.equal(result.kind, 'modern');
  assert.equal(result.revision, '2026-07-28');
  assert.deepEqual(revisions, ['2027-01-01', '2026-07-28']);
});

test('modern pin rejects malformed, legacy-only and unsupported revision fixtures', async () => {
  for (const fixture of [
    fixtures.malformed_discovery,
    fixtures.legacy_only,
    fixtures.unsupported_revision,
  ]) {
    const methods = [];
    const result = await negotiateMcpEra({
      allowLegacyFallback: false,
      exchange: async (request) => {
        methods.push(request.method);
        return fixture.discover;
      },
    });
    assert.notEqual(result.kind, 'modern');
    assert.deepEqual(methods, ['server/discover']);
  }
});

test('stateful legacy follow-up carries the negotiated revision and session id', () => {
  const context = followupRequestContext(fixtures.stateful_legacy.negotiated);
  assert.equal(context.session_model, 'stateful');
  assert.deepEqual(context.headers, {
    'MCP-Protocol-Version': '2025-11-25',
    'Mcp-Session-Id': 'fixture-session-1',
  });
  assert.equal(context.meta, null);
});

test('modern follow-up is sessionless and repeats the per-request envelope', () => {
  const context = followupRequestContext(fixtures.sessionless_modern.negotiated, {
    clientInfo: { name: 'fixture', version: '1' },
  });
  assert.equal(context.session_model, 'request_scoped');
  assert.equal(Object.hasOwn(context.headers, 'Mcp-Session-Id'), false);
  assert.equal(context.headers['MCP-Protocol-Version'], '2026-07-28');
  assert.equal(context.meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
});

test('auth, 5xx and HTTP timeouts never select legacy', () => {
  assert.equal(classifyProbeFailure({ status: 401 }).kind, 'authorization_error');
  assert.equal(classifyProbeFailure({ status: 403 }).kind, 'authorization_error');
  assert.equal(classifyProbeFailure({ status: 503 }).kind, 'transport_error');
  assert.equal(classifyProbeFailure({ name: 'AbortError' }, { transport: 'http' }).kind, 'transport_error');
});

test('stdio timeout and opaque browser CORS failure are bounded fallback candidates', () => {
  assert.equal(
    classifyProbeFailure({ name: 'AbortError' }, { transport: 'stdio' }).reason,
    'stdio_probe_timeout',
  );
  assert.equal(
    classifyProbeFailure(new TypeError('Failed to fetch'), { transport: 'browser_http' }).reason,
    'browser_opaque_cors_probe_failure',
  );
});

test('modern JSON-RPC errors do not silently downgrade', async () => {
  const methods = [];
  const result = await negotiateMcpEra({ exchange: async (request) => {
    methods.push(request.method);
    return { jsonrpc: '2.0', id: request.id, error: { code: -32020, message: 'Header mismatch' } };
  } });
  assert.equal(result.kind, 'modern_error');
  assert.deepEqual(methods, ['server/discover']);
});

// #3597: reproduces the DeepWiki-like false negative — server/discover with the modern
// MCP-Protocol-Version header answers HTTP 400 / JSON-RPC -32600 "Invalid Request" (no structured
// data.supported list), and the server would happily answer legacy initialize if we tried it.
// Before the fix this hard-failed as modern_error and initialize was never attempted.
test('400/-32600 with no structured advice falls back to legacy initialize (DeepWiki-like false negative)', async () => {
  assert.equal(
    classifyDiscoverResponse(fixtures.deepwiki_like.discover).reason,
    'server_discover_invalid_request',
  );
  const methods = [];
  const result = await negotiateMcpEra({
    exchange: async (request) => {
      methods.push(request.method);
      return request.method === 'server/discover'
        // outcome shape mirrors what the real HTTP exchange returns: {status, response, ...} — status
        // is deliberately NOT what gates this decision (401/403/5xx already hard-fail one layer up,
        // before negotiateMcpEra ever sees the outcome); the JSON-RPC error code is what's inspected.
        ? { status: fixtures.deepwiki_like.discover_http_status, response: fixtures.deepwiki_like.discover }
        : { status: 200, response: fixtures.deepwiki_like.initialize };
    },
  });
  assert.equal(result.kind, 'legacy');
  assert.equal(result.entry_method, 'initialize');
  assert.equal(result.fallback_reason, 'server_discover_invalid_request');
  assert.deepEqual(methods, ['server/discover', 'initialize']);
});

// #3597: companion case — 200/-32601 "Method not found" also falls back (already covered end-to-end by
// the 'legacy-only endpoint falls back' test above; asserted directly here against the classifier so the
// two DeepWiki-issue-listed cases are pinned side by side).
test('200/-32601 method-not-found falls back to legacy (companion to the 400/-32600 case)', () => {
  const result = classifyDiscoverResponse({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } });
  assert.equal(result.kind, 'legacy_candidate');
  assert.equal(result.reason, 'server_discover_method_not_found');
});

// #3597: the fix must NOT convert every 400 into a downgrade — an opaque error code unrelated to
// protocol/method support (no data.supported, not -32600/-32601/-32022) still hard-fails as
// modern_error and legacy initialize is never attempted, preserving a genuine non-protocol failure.
test('genuine non-protocol 400 (opaque -32603, no structured advice) does not fall back', async () => {
  assert.equal(
    classifyDiscoverResponse(fixtures.genuine_invalid_request.discover).kind,
    'modern_error',
  );
  const methods = [];
  const result = await negotiateMcpEra({
    exchange: async (request) => {
      methods.push(request.method);
      return { status: fixtures.genuine_invalid_request.discover_http_status, response: fixtures.genuine_invalid_request.discover };
    },
  });
  assert.equal(result.kind, 'modern_error');
  assert.deepEqual(methods, ['server/discover']); // initialize never attempted
});

// #3597: -32600 carrying a structured data.supported list (the original Setix case, #cd2b5716c) must
// keep taking the more precise revision_advice path — a same-modern-generation retry — rather than
// jumping straight to legacy, which the new bare-32600 handling must not short-circuit.
test('-32600 WITH structured advice still takes the precise revision_advice path, not the bare-32600 fallback', () => {
  const result = classifyDiscoverResponse({
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32600, message: 'Unsupported MCP-Protocol-Version', data: { supported: ['2026-07-28'] } },
  });
  assert.equal(result.kind, 'revision_advice');
  assert.deepEqual(result.advised_versions, ['2026-07-28']);
});

// #3597: auth failures must never be reinterpreted as protocol-negotiation signal — a 401/403 at the
// transport layer (thrown by the exchange() wrapper, per mcp-dual-stack-http.mjs/pack-standard.mjs)
// stays a terminal authorization_error and is never routed toward legacy fallback.
test('auth-required (401/403) is preserved as terminal, never downgraded to legacy fallback', async () => {
  const methods = [];
  const result = await negotiateMcpEra({
    exchange: async (request) => {
      methods.push(request.method);
      throw Object.assign(new Error('mcp_http_401'), { status: 401 });
    },
  });
  assert.equal(result.kind, 'authorization_error');
  assert.deepEqual(methods, ['server/discover']); // initialize never attempted for an auth failure
});
