# Changelog

All notable changes to `mcp-readiness`.

## 0.7.0 — 2026-08-26

### Added — dual-stack protocol entry (modern `server/discover`, falling back to legacy `initialize`)

The hosted SaSame Observatory's canonical engine moved to a dual-stack protocol entry: it tries the
modern MCP `server/discover` method first and falls back to legacy `initialize` only when needed
(#3597). This CLI now speaks the same negotiation — a compliant modern-only server (one that never
implements `initialize` at all) can now be graded; before this release, this CLI only ever attempted
`initialize` and would have hard-failed C1 against such a server, exactly the class of false-negative
this release closes from the other direction.

The negotiation decision tree (`src/mcp-era-negotiation.mjs`) is the canonical module
(`packages/capability-runtime/src/lib/mcp-era-negotiation.mjs`) vendored **byte-for-byte** — this
package cannot depend on SaSame's private internal workspace package, but the canonical module has
zero external imports, so rather than porting/reimplementing its decision tree (which drifted from
canonical on untested branches in an earlier revision of this release — see the entry below),
it is copied verbatim. `test/canonical-parity-guard.test.mjs` byte-diffs the vendored copy against the
canonical source on every test run (from inside this repo checkout) and fails the instant they
diverge, so re-syncing is never optional or silently skippable. `test/mcp-era-negotiation.test.mjs`
(the canonical module's own test suite, copied verbatim with fixtures) also runs directly against this
vendored copy. The bounded legacy-revision ladder for servers older than the current legacy pin now
lives inside `negotiateMcpEra` itself, exactly as in canonical (up to 3 `initialize` attempts) — see
`test/revision-fallback.test.mjs`, unchanged and still green.

- **Fixed — DeepWiki-like false negative for the modern era.** A `server/discover` call answering
  HTTP 400 / JSON-RPC `-32600` "Invalid Request" with no structured `data.supported` list now falls
  back to legacy `initialize` instead of being treated as a hard failure (#3597; see
  `test/era-negotiation-integration.test.mjs` for a live-fixture regression of this exact shape, and
  the `-32601` "Method not found" companion case).
- **Changed (non-breaking) `--json` additions:** `entry_method` (`"server/discover"` or
  `"initialize"`), `protocol_revision` (the negotiated MCP revision), `session_model`
  (`"request_scoped"`, `"stateful"`, or `"stateless_legacy"` for a legacy `initialize` success that
  issued no session id), and `extensions` (modern protocol extension keys the server declared, `[]`
  otherwise). All existing fields are unchanged.
- **Fixed (pre-publish, #3607 — two rounds of independent audit).** Round 1 found and fixed four
  behavioral drifts in a hand-written reimplementation of the canonical decision tree, verified only
  against the canonical module's own (non-exhaustive) test suite: malformed/incomplete `server/discover`
  results mis-classified as terminal instead of a bounded legacy fallback; a legacy `initialize` success
  with no session id mislabeled `"stateful"` instead of `"stateless_legacy"`; a second round of
  structured revision-advice leaking an internal classification as a terminal result instead of falling
  back to legacy; and an stdio-probe timeout / opaque browser CORS failure classified as a terminal
  transport error instead of a bounded fallback. Round 2 correctly rejected that fix as still
  insufficient — a reimplementation "verified" only against a non-exhaustive shared suite can drift on
  branches that suite never exercises, and round 1's own new tests were open to the same limitation.
  **`src/mcp-era-negotiation.mjs` is now the canonical module vendored byte-for-byte** (see above) —
  round 2's concrete complaints (extension-array handling, mutually-supported-revision selection on a
  successful discover, `statusCode` support, empty-`supportedModernRevisions` validation, the in-module
  legacy ladder) are resolved as a structural consequence of that, not by further hand-patching, and
  `test/canonical-parity-guard.test.mjs` makes a third round of silent drift structurally impossible.
  No `--json` field was added or removed by either round; `session_model` simply reports a third,
  honest value (`"stateless_legacy"`) canonical has always been able to report.
- **Changed** C1 is renamed "Protocol entry conformance" (was "Protocol handshake conformance") and
  its `derived_from`/evidence text now names the actual entry method and negotiated revision — a
  truthful description of dual-stack entry, not a breaking field removal. C6's `derived_from` wording
  is updated to match ("successful revision-appropriate protocol entry" — the `<5000ms` bar and
  latency measurement itself are unchanged).
- `standard_version` is now `agent-tool-discoverability-standard/0.4`, matching the version already in
  use by the hosted Observatory's canonical engine since #3597.
- No change to C2–C10 pass/fail logic, grade thresholds, the honesty cap, exit codes, the legacy
  real-world ladder (`LEGACY_FALLBACK_LADDER`, still exported), or the Gold Rush v1 compatibility
  commands.
- Deliberately **out of scope** for this release: the canonical engine's Observatory-only advisory
  layers added alongside #3597/#2324 (`security_signals`, `capability_signals`, TLS/OAuth probes,
  `tools_list` dossier). Those are hosted-service telemetry unrelated to the C1–C10 Standard or the
  #3597 correctness fix, and adding them here would pull new network calls and complexity into a
  zero-dep CLI beyond what this release's objective covers.

## 0.6.1 — 2026-08-25

### Changed — hand off to the current free Capability Control Beta

- The primary post-audit handoff now points to `https://srl-sasame.com/start`, the current SaSame Capability Control Beta entry path.
- The CLI and README state the current beta access boundary directly: free during beta and no payment method required for new users.
- Existing `gold-rush start|status|run|report` commands are preserved unchanged for compatibility, but are now explicitly labeled legacy instead of being presented as SaSame's current product path.
- `--json` keeps the existing `activation.baseline_url` and `activation.pricing_url` fields and adds non-breaking beta metadata (`beta_url`, `beta_name`, `beta_access`, `payment_method_required`).
- The 10 readiness criteria, grade thresholds, audit transport behavior, exit codes, and Gold Rush command mechanics are unchanged.

## 0.6.0 — 2026-08-13

### Changed — removed the stale $99 "activation repair" Stripe link (breaking JSON field)

The README, `--help`/text output, and the `--json` `activation` object advertised a paid
"activation repair ($99, one-time)" SKU with a live-looking Stripe buy link
(`buy.stripe.com/14A9ATbezeuicyBdED1ZS1p`). That SKU no longer exists in the current SaSame
Factory commercial model: the old "Activation" product line was retired, and its closest
current analog (Assisted Review, EUR 99 one-time) currently has `price_state=APPROVED_NOT_LIVE`
— i.e. not purchasable. Advertising a working-looking checkout link for a dead/non-purchasable
product is worse than saying nothing.

- `activation.repair_url` and `activation.price_usd` are **removed** from `--json` output
  (breaking change for anything reading those fields — hence the minor bump on a 0.x package).
- `activation.pricing_url` is **added**, pointing at `https://srl-sasame.com/pricing`, the live
  page that always reflects current prices and `price_state` — this CLI does not hard-code prices.
- Text output and the README no longer print a specific dollar figure or Stripe link for
  activation repair; they state plainly that no such SKU is currently sold.
- No change to the free activation baseline, the Gold Rush handoff commands, or any of the 10
  readiness criteria.

## 0.5.0 — 2026-07-29

### Fixed — servers speaking only pre-2025-11-25 MCP revisions were given a FALSE grade D

**If you graded a server with 0.4.1 or earlier and got `D` with `0 tools`, please re-run it.
The result may have been our bug, not your server.**

`mcp-readiness` sent exactly one `initialize`, pinned to protocol revision `2025-11-25`, and gave up
if that was rejected. A server that speaks only earlier revisions — `2025-06-18`, `2025-03-26`,
`2024-11-05`, which is most of the deployed ecosystem — failed C1, never reached `tools/list`, and
cascade-failed C2 through C9 off that one bad assumption. The reported grade was `D`, `1-3/10`,
`0 tools`, for servers that are in fact conformant.

Many such servers reject cooperatively, naming what they *do* support:

```json
{"jsonrpc":"2.0","id":null,"error":{
  "code":-32600,"message":"Unsupported MCP-Protocol-Version",
  "data":{"supported":["2024-11-05","2025-03-26","2025-06-18"],"requested":"2025-11-25"}}}
```

We ignored that. Now:

- Any JSON-RPC error carrying a structured `data.supported` / `data.supportedVersions` list is
  treated as revision advice, **regardless of error code**. (We previously only recognised the
  spec-suggested `-32022`; real servers reject with `-32600` and others.)
- If no list is advertised, we walk a real-world ladder: `2025-06-18` → `2025-03-26` → `2024-11-05`.
- Bounded to 3 attempts total, so an uncooperative server cannot stretch the audit's latency budget.
- A genuinely unreachable or broken endpoint still grades `D`. The fallback recovers servers that
  speak an older revision; it does not paper over dead ones.

`C1` evidence now names the revision that was negotiated and the ones that were offered, e.g.
`initialize negotiated 2025-06-18 (offered 2025-11-25 -> 2025-06-18)`.

### Fixed — C3 evidence named the wrong dimension on failure

C3 checks three things (name charset, non-empty description, object `inputSchema`) but the evidence
line reported only the **schema**-passing count while labelling it as all three. A server failing
purely on the name charset saw this next to a FAIL:

```
FAIL  C3  54/54 tools: valid name + non-empty desc + object (or bare {}) inputSchema
```

Self-contradictory, and it hid the dimension you would need to fix. Evidence now reports each
failing dimension with counts and up to three example tool names:

```
FAIL  C3  54/54 name not /^[A-Za-z0-9_-]{1,128}$/ (svc.health, svc.lookup, svc.settle …)
```

### Notes

- Grade *thresholds* and the ten criteria are unchanged. Grades may still move, because servers that
  could not be measured before can be measured now.
- Both fixes are also live in the hosted SaSame Observatory engine, and CLI and hosted output were
  verified to agree on a real third-party server after the fix.
- New regression test: `test/revision-fallback.test.mjs`, wired into `npm test`.

### Credit

Found because Setix (`mcp.setix.dev`) invited us to grade their public MCP server and we produced a
false `D 1/10` for it. They asked to be measured rather than described; the first measurement we
handed them was wrong, and finding out why is what produced this release. If a check here looks
wrong or unfair to your server, please tell us — that is how this got fixed.

## 0.4.x and earlier

See the git history and npm release list. 0.3.0 added the Gold Rush v1 handoff mode
(`gold-rush start|status|run|report`); 0.1.0 was the first public release.
