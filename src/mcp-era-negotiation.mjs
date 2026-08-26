export const MODERN_PROTOCOL_REVISION = '2026-07-28';
export const DEFAULT_LEGACY_PROTOCOL_REVISION = '2025-11-25';
// Real-world pre-2025-11-25 revisions still running in production (most servers built before the
// 2026-07-28 stateless-core break never adopted the 2025-11-25 legacy pin either). Tried, newest
// first, only when DEFAULT_LEGACY_PROTOCOL_REVISION itself is rejected — see negotiateMcpEra.
export const LEGACY_FALLBACK_LADDER = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';
export const CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo';
export const CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities';

const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';

export function modernEnvelope({ clientInfo, clientCapabilities = {}, revision = MODERN_PROTOCOL_REVISION } = {}) {
  return {
    [PROTOCOL_VERSION_META_KEY]: revision,
    ...(clientInfo ? { [CLIENT_INFO_META_KEY]: clientInfo } : {}),
    [CLIENT_CAPABILITIES_META_KEY]: clientCapabilities,
  };
}

export function discoverRequest({ id = 1, clientInfo, clientCapabilities = {}, revision = MODERN_PROTOCOL_REVISION } = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'server/discover',
    params: { _meta: modernEnvelope({ clientInfo, clientCapabilities, revision }) },
  };
}

export function legacyInitializeRequest({ id = 1, clientInfo, clientCapabilities = {}, revision = DEFAULT_LEGACY_PROTOCOL_REVISION } = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: revision,
      capabilities: clientCapabilities,
      clientInfo: clientInfo || { name: 'sasame-probe', version: '1.0.0' },
    },
  };
}

export function isMethodNotFound(response) {
  return response?.jsonrpc === '2.0' && response?.error?.code === -32601;
}

export function classifyDiscoverResponse(
  response,
  { supportedModernRevisions = [MODERN_PROTOCOL_REVISION] } = {},
) {
  if (!isRecord(response)) return fallbackCandidate('non_object_response');
  if (isMethodNotFound(response)) return fallbackCandidate('server_discover_method_not_found');
  if (response.error) {
    // -32022 is the spec's suggested code for "unsupported protocol version", but real servers that
    // validate the MCP-Protocol-Version header before routing often reject with a different code (e.g.
    // -32600 "invalid request") while still naming what they support in error.data.supported. Treat ANY
    // error carrying that structured list as revision advice, not just the -32022 case — an opaque error
    // with no such list (e.g. a genuine "Header mismatch") still hard-fails as modern_error, no downgrade.
    const advised = extractAdvisedLegacyVersions(response.error);
    if (response.error.code === -32022 || advised.length) {
      return {
        kind: 'revision_advice',
        reason: 'unsupported_protocol_version',
        advised_versions: advised,
        error: response.error,
      };
    }
    // -32600 "Invalid Request" with NO structured advice (the case above already claimed it when
    // present): discoverRequest() always emits a spec-valid Request object, so a compliant server
    // rejecting it with -32600 cannot mean "your JSON was malformed" — in practice (observed from
    // DeepWiki-style servers whose HTTP layer validates the modern server/discover method/_meta
    // envelope before ever reaching JSON-RPC method dispatch, often returning it as HTTP 400) it means
    // the same "I don't implement this modern entry point" as -32601, just from a less-precise
    // validator. Treat it identically: an unconditional legacy-fallback candidate, never terminal.
    // Every OTHER error code (e.g. -32603 Internal error, or an opaque -32020 "Header mismatch") still
    // hard-fails as modern_error below — this does not convert every 400 into a downgrade, only the
    // JSON-RPC "invalid request" code on our own well-formed request.
    if (response.error.code === -32600) {
      return fallbackCandidate('server_discover_invalid_request');
    }
    return {
      kind: 'modern_error',
      reason: 'server_discover_error',
      error: response.error,
    };
  }

  const result = response.result;
  if (!isRecord(result)) return fallbackCandidate('missing_discover_result');
  if (result.resultType !== 'complete') return fallbackCandidate('invalid_discover_result_type');
  if (!Array.isArray(result.supportedVersions) || result.supportedVersions.length === 0
      || result.supportedVersions.some((value) => typeof value !== 'string' || value.length === 0)) {
    return fallbackCandidate('invalid_supported_versions');
  }
  if (!isRecord(result.capabilities)) return fallbackCandidate('invalid_capabilities');

  const revision = supportedModernRevisions.find((candidate) => result.supportedVersions.includes(candidate));
  if (!revision) {
    return {
      ...fallbackCandidate('no_mutually_supported_modern_revision'),
      advertised_versions: [...result.supportedVersions],
    };
  }

  return {
    kind: 'modern',
    revision,
    entry_method: 'server/discover',
    session_model: 'request_scoped',
    discover: result,
    advertised_versions: [...result.supportedVersions],
    extensions: normalizeExtensions(result.capabilities.extensions),
    server_info: result._meta?.[SERVER_INFO_META_KEY] || null,
  };
}

function normalizeExtensions(raw) {
  if (Array.isArray(raw)) return raw.filter((value) => typeof value === 'string').sort();
  if (isRecord(raw)) return Object.keys(raw).sort();
  return [];
}

function fallbackCandidate(reason) {
  return { kind: 'legacy_candidate', reason };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function numericStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function isTimeout(error) {
  return error?.name === 'AbortError'
    || error?.code === 'ETIMEDOUT'
    || error?.code === 'ERR_REQUEST_TIMEOUT'
    || error?.timeout === true;
}

export function classifyProbeFailure(error, { transport = 'http' } = {}) {
  const status = numericStatus(error?.status ?? error?.statusCode);
  if (status === 401 || status === 403) {
    return { kind: 'authorization_error', reason: `http_${status}`, status, error };
  }
  if (status !== null && status >= 500) {
    return { kind: 'transport_error', reason: 'http_server_error', status, error };
  }
  if (isTimeout(error)) {
    return transport === 'stdio'
      ? fallbackCandidate('stdio_probe_timeout')
      : { kind: 'transport_error', reason: 'http_probe_timeout', error };
  }
  if (transport === 'browser_http' && error instanceof TypeError) {
    return fallbackCandidate('browser_opaque_cors_probe_failure');
  }
  return { kind: 'transport_error', reason: 'probe_transport_failure', error };
}

function extractAdvisedLegacyVersions(error) {
  const advised = error?.data?.supported ?? error?.data?.supportedVersions;
  return Array.isArray(advised) ? advised.filter((v) => typeof v === 'string' && v.length > 0) : [];
}

export function classifyLegacyInitializeResponse(
  response,
  offeredRevision = DEFAULT_LEGACY_PROTOCOL_REVISION,
  { sessionId = null } = {},
) {
  if (!isRecord(response)) return { kind: 'invalid', reason: 'non_object_response' };
  if (response.error) {
    return {
      kind: 'legacy_error',
      reason: 'initialize_error',
      error: response.error,
      // a server that rejects our pinned revision often names what IT supports (e.g. -32600
      // "Unsupported MCP-Protocol-Version" with data.supported: [...]) — negotiateMcpEra retries
      // with that instead of silently grading the server dead.
      advised_versions: extractAdvisedLegacyVersions(response.error),
    };
  }
  const result = response.result;
  if (!isRecord(result) || typeof result.protocolVersion !== 'string') {
    return { kind: 'invalid', reason: 'missing_legacy_protocol_version' };
  }
  return {
    kind: 'legacy',
    revision: result.protocolVersion || offeredRevision,
    entry_method: 'initialize',
    session_model: sessionId ? 'stateful' : 'stateless_legacy',
    session_id: sessionId,
    discover: null,
    extensions: normalizeExtensions(result.capabilities?.extensions),
    server_info: result.serverInfo || null,
  };
}

export function followupRequestContext(
  negotiated,
  { clientInfo, clientCapabilities = {}, legacySessionId = negotiated?.session_id || null } = {},
) {
  if (negotiated?.kind === 'modern') {
    return {
      revision: negotiated.revision,
      session_model: 'request_scoped',
      headers: { 'MCP-Protocol-Version': negotiated.revision },
      meta: modernEnvelope({ clientInfo, clientCapabilities, revision: negotiated.revision }),
    };
  }
  if (negotiated?.kind === 'legacy') {
    return {
      revision: negotiated.revision,
      session_model: legacySessionId ? 'stateful' : 'stateless_legacy',
      headers: {
        'MCP-Protocol-Version': negotiated.revision,
        ...(legacySessionId ? { 'Mcp-Session-Id': legacySessionId } : {}),
      },
      meta: null,
    };
  }
  throw new TypeError('follow-up context requires a negotiated modern or legacy result');
}

function unwrapExchangeResult(outcome) {
  if (isRecord(outcome) && Object.hasOwn(outcome, 'response')) {
    return {
      response: outcome.response,
      sessionId: outcome.sessionId || outcome.session_id || null,
    };
  }
  return { response: outcome, sessionId: null };
}

export async function negotiateMcpEra({
  exchange,
  clientInfo = { name: 'sasame-probe', version: '1.0.0' },
  clientCapabilities = {},
  supportedModernRevisions = [MODERN_PROTOCOL_REVISION],
  legacyRevision = DEFAULT_LEGACY_PROTOCOL_REVISION,
  allowLegacyFallback = true,
  transport = 'http',
} = {}) {
  if (typeof exchange !== 'function') throw new TypeError('exchange must be a function');
  if (!Array.isArray(supportedModernRevisions) || supportedModernRevisions.length === 0) {
    throw new TypeError('supportedModernRevisions must contain at least one revision');
  }

  const modernRevision = supportedModernRevisions[0];
  let attemptedRevision = modernRevision;
  let modern = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const discover = discoverRequest({
      clientInfo,
      clientCapabilities,
      revision: attemptedRevision,
      id: attempt + 1,
    });
    try {
      const outcome = unwrapExchangeResult(await exchange(discover, {
        era: attempt === 0 ? 'modern_probe' : 'modern_revision_retry',
        revision: attemptedRevision,
        transport,
      }));
      modern = classifyDiscoverResponse(outcome.response, { supportedModernRevisions });
    } catch (error) {
      modern = classifyProbeFailure(error, { transport });
    }

    if (modern.kind !== 'revision_advice') break;
    const advisedRevision = supportedModernRevisions.find(
      (revision) => modern.advised_versions.includes(revision) && revision !== attemptedRevision,
    );
    if (!advisedRevision || attempt === 1) {
      modern = {
        ...fallbackCandidate(
          advisedRevision ? 'modern_revision_retry_exhausted' : 'no_mutually_supported_modern_revision',
        ),
        advertised_versions: modern.advised_versions,
        error: modern.error,
      };
      break;
    }
    attemptedRevision = advisedRevision;
  }

  if (modern.kind === 'modern') return modern;
  if (modern.kind !== 'legacy_candidate' || !allowLegacyFallback) {
    return {
      ...modern,
      revision: modernRevision,
      entry_method: 'server/discover',
      session_model: 'unknown',
    };
  }

  // legacyRevision (DEFAULT_LEGACY_PROTOCOL_REVISION) is our best guess, not every server's reality —
  // if the server rejects it, retry with whatever it told us it supports (advised_versions), then the
  // known real-world ladder, before concluding the server has no usable entry point at all. Bounded to
  // 3 total legacy attempts so a stubbornly-uncooperative server can't blow out the audit's latency budget.
  const legacyCandidates = [legacyRevision];
  let legacy = null;
  let attemptIndex = 0;
  while (attemptIndex < legacyCandidates.length && attemptIndex < 3) {
    const revision = legacyCandidates[attemptIndex];
    const initialize = legacyInitializeRequest({ clientInfo, clientCapabilities, revision });
    const legacyOutcome = unwrapExchangeResult(await exchange(initialize, {
      era: 'legacy_fallback',
      revision,
      transport,
    }));
    legacy = classifyLegacyInitializeResponse(legacyOutcome.response, revision, { sessionId: legacyOutcome.sessionId });
    if (legacy.kind === 'legacy') break;
    if (legacy.kind === 'legacy_error') {
      const nextCandidate = [...legacy.advised_versions].sort().reverse()
        .concat(LEGACY_FALLBACK_LADDER)
        .find((v) => !legacyCandidates.includes(v));
      if (nextCandidate) legacyCandidates.push(nextCandidate);
    }
    attemptIndex += 1;
  }
  return {
    ...legacy,
    fallback_from: modernRevision,
    fallback_reason: modern.reason,
    legacy_attempts: legacyCandidates.slice(0, attemptIndex + 1),
  };
}

