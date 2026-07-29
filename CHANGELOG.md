# Changelog

All notable changes to `mcp-readiness`.

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
