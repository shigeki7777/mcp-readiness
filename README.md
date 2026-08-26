# mcp-readiness

**Lighthouse for MCP servers.** Point it at any public [Model Context Protocol](https://modelcontextprotocol.io) server and get a graded readiness report in ~2 seconds — handshake, tool quality, safety annotations, anti-ghost content, token efficiency, honest errors — plus a Claude/ChatGPT directory pre-flight.

Zero dependencies. Zero config. Zero telemetry. Runs anywhere Node 18+ runs.

> ### ⚠️ Graded something with 0.4.1 or earlier and got `D` / `0 tools`? Please re-run it on 0.5.0.
>
> Versions up to 0.4.1 sent a single `initialize` pinned to MCP revision `2025-11-25` and gave up if
> it was rejected. Servers speaking only earlier revisions (`2025-06-18`, `2025-03-26`, `2024-11-05`
> — most of the deployed ecosystem) failed the handshake, never reached `tools/list`, and
> cascade-failed to a **false grade `D`**. 0.5.0 honours whatever revisions a server advertises and
> falls back down a real ladder. A genuinely dead endpoint still grades `D`.
>
> Details, including the second fix (C3 evidence named the wrong failing dimension), are in
> [CHANGELOG.md](./CHANGELOG.md). This was found because someone invited us to grade their server and
> we got it wrong. If a check looks wrong or unfair to your server, please
> [open an issue](https://github.com/shigeki7777/mcp-readiness/issues) — that is how this got fixed.

> **Part of [SaSame MCP Factory](https://srl-sasame.com).** This CLI is the forkable, local twin of the
> Factory's inspection engine — the same 10 criteria the hosted [SaSame MCP
> Observatory](https://github.com/shigeki7777/sasame-mcp-observatory) uses to continuously inspect and
> observe MCP servers. Run it standalone, then continue through the current free **Capability Control
> Beta** at <https://srl-sasame.com/start>. Historical Gold Rush commands remain available only for
> compatibility with existing scripts.

```bash
npx mcp-readiness https://mcp.example.com/mcp
```

If this is **your** MCP server, the next step after the grade is to claim the public SaSame Readiness Passport:

```text
1. Run: npx mcp-readiness https://your-server.example/mcp
2. Open: https://github.com/shigeki7777/sasame-mcp-observatory/issues/new?template=claim-passport.yml
3. Or connect the SaSame public MCP and call: claim_start(url) → claim_confirm
```

Claiming is free. It proves owner control; it does **not** create a safety endorsement, paid ranking, custody relationship, or tax document.

## Put it on every pull request

```yaml
- uses: shigeki7777/mcp-readiness@v1
  with:
    endpoint: ${{ vars.MCP_ENDPOINT }}
    min-grade: B
```

The Action writes the complete result into the GitHub Step Summary, emits annotations for failed
criteria, saves `mcp-readiness-report.json`, and fails when the measured grade drops below the
configured threshold. It needs no token and sends no telemetry to SaSame. For a server started by
the workflow, pass its localhost Streamable HTTP URL instead. A complete workflow is in
[`examples/readiness.yml`](examples/readiness.yml).

A real run — a strong server that's **one fix from a clean directory pre-flight** (one criterion to address, not a verdict on your work):

```
  MCP Readiness    B    9/10 criteria  ·  11 tools  ·  134ms
  https://mcp.example.com/mcp

  PASS  C1 Protocol entry conformance
  PASS  C2 Tool listability
  PASS  C3 Tool object validity
  PASS  C4 Description sufficiency / selectability
  FAIL  C5 Safety annotation presence
        0/11 tools carry a valid safety-hint annotation
  PASS  C6 Liveness & latency
  PASS  C7 Returns real content (anti-ghost)
  PASS  C8 Machine-discoverable identity
  PASS  C9 Token efficiency
  PASS  C10 Honest error behavior

  Top fix  C5 Safety annotation presence — 0/11 tools carry a valid safety-hint annotation
  Directory pre-flight  1 mechanical blocker(s) for Claude/ChatGPT listing
```

## Why

Agents discover your MCP server through its `tools/list`. If a tool has no description, no
`readOnlyHint`, returns nothing on a safe call, or your server bloats every context with a 120 KB
tool list, the agent can't find, trust, or call it — and the Claude Connectors / ChatGPT Apps
directories will reject it for mechanical reasons before a human ever reviews it. `mcp-readiness` checks
the things that actually decide whether your server gets used, and tells you the one fix that moves
the needle.

## Install / run

```bash
npx mcp-readiness <url>                 # one-off, no install
npx mcp-readiness http://localhost:3000/mcp   # audit your server while you build it
npm i -g mcp-readiness && mcp-readiness <url>     # or install globally
```

Use it in CI — it exits non-zero when a server drops below a B:

```yaml
- run: npx mcp-readiness "$MCP_URL"     # exit 0 = A/B, 1 = C/D, 2 = usage error (bad/missing arguments)
```

An unreachable host is a measurement, not a usage error: the audit still completes all 10 criteria,
grades **D**, and exits **1**. Exit code 2 fires only for usage errors (e.g. no URL given).

```bash
npx mcp-readiness <url> --json          # machine-readable full report
```

## After the grade: continue in SaSame free beta

`mcp-readiness` is the local, reproducible check. The current new-user path in SaSame is **Capability Control Beta**: start at <https://srl-sasame.com/start>, sign in, connect an AI, choose the capabilities it may use, and run bounded work. **It is free during the current beta and requires no payment method.**

The hosted SaSame MCP Observatory remains the public measurement/ownership record:

- If the endpoint is yours: claim it free with `claim_start(url)` → `claim_confirm` on `https://live-vps.sasame.online/public-mcp`.
- If you prefer GitHub: open the claim template at `https://github.com/shigeki7777/sasame-mcp-observatory/issues/new?template=claim-passport.yml`.
- If you are checking a peer: use the grade as a mechanical pre-flight only; it is not a malware scan, endorsement, or quality verdict.

## Activation: discovered is not the same as called

A good grade means agents *can* call your server — not that they *do*. Crawlers and directories
may DISCOVER a server (fetch its `tools/list`) without any agent ever CALLING its tools.

- **Free activation baseline.** The hosted Observatory publishes what it has actually observed:
  discovery events vs. real tool calls. Find your server at
  <https://live-vps.sasame.online/observatory/check/>, or connect the SaSame public MCP
  (`https://live-vps.sasame.online/public-mcp`) and call `start_here()` for the guided baseline.
  Measurement only — the numbers can be zero, and a baseline is not an endorsement or a promise
  of traffic.
- **Current new-user handoff.** Capability Control Beta is the active acquisition path at
  <https://srl-sasame.com/start>. New users do not need a payment method during the beta. Historical
  plan records and their current availability remain visible at <https://srl-sasame.com/pricing>;
  this CLI does not infer purchasability from old plan names or prices.
- **Boundary:** measurement, not endorsement. No adoption guarantees — the evidence shows what
  changed in observed external calls, not a promised outcome.

## Legacy Gold Rush v1 compatibility (optional)

The `gold-rush` subcommands remain available so existing scripts do not break. They are a **legacy compatibility surface**, not SaSame's current product identity or primary new-user path. They still drive the historical measurement/package flow over the public MCP and keep the same no-payment, no-key boundaries.

```bash
npx mcp-readiness gold-rush start  https://mcp.example.com/mcp    # create/identify a package -> package_id
npx mcp-readiness gold-rush run    <package-id>                   # advance one deterministic safe step
npx mcp-readiness gold-rush status <package-id>                   # read append-only package state
npx mcp-readiness gold-rush report <package-id>                   # produce the Visibility Report
```

- Add `--json` for machine output, `--goal <preset>` on `start` (e.g. `quick_claim`, `visibility_check`), or `--endpoint <url>` to target another SaSame public MCP.
- No API key. The public surface is free and needs no token; this CLI sends no credentials.
- **Boundaries (non-negotiable):** measurement record, **not** endorsement · claim status, **not** identity/KYC verification · runtime health, **not** a security verdict · receipt, **not** a fiscal invoice or payment guarantee.
- **No payment:** these compatibility commands never trigger live settlement, DNS changes, wallet publication, external account creation, legal, or KYC actions.
- Methodology (what is / is not measured): <https://live-vps.sasame.online/observatory/methodology.html>

The existing `npx mcp-readiness <url>` audit works exactly as before. The primary SaSame handoff is now <https://srl-sasame.com/start>; Gold Rush remains compatibility-only.

## The 10 criteria

Standard: `agent-tool-discoverability-standard/0.4` (the `--json` output embeds it as `standard_version`).
Each criterion is bound to the MCP spec or a direct measurement — not taste. Grade: **A** =10 · **B** 8–9 · **C** 5–7 · **D** below. (A server that never returns verifiable content is capped at **B** — honesty cap.)

| | Criterion | Bound to |
|---|---|---|
| C1 | Protocol entry conformance | modern `server/discover`, with revision-aware fallback to legacy `initialize` — either returning `protocolVersion`/`supportedVersions` + `capabilities` |
| C2 | Tool listability | `tools/list` returns `result.tools[]` |
| C3 | Tool object validity | valid name + non-empty description + object `inputSchema` (a bare `{}` — valid JSON Schema for no-arg tools — is accepted; missing/null is rejected) |
| C4 | Description sufficiency | every desc ≥12 chars, median ≥20, ≥60% distinct |
| C5 | Safety annotation presence | a boolean hint (`readOnlyHint`/`destructiveHint`/…) on ≥50% of tools |
| C6 | Liveness & latency | successful revision-appropriate protocol entry < 5000 ms |
| C7 | Returns real content (anti-ghost) | a read-only tool returns substantive, non-echo content; priced/x402 → UNVERIFIED |
| C8 | Machine-discoverable identity | `serverInfo` name + version |
| C9 | Token efficiency | decoded `tools/list` result payload < 40 KB |
| C10 | Honest error behavior | unknown method → structured JSON-RPC error, not a hang |

Measurement semantics (v0.4): protocol entry tries the modern `server/discover` method first
(`--json` reports which one actually answered as `entry_method`, plus `protocol_revision` and
`session_model`); a server that doesn't implement it — or answers with a DeepWiki-like 400/-32600
"Invalid Request" carrying no structured revision advice — falls back to legacy `initialize`, which
itself walks a bounded real-world ladder of older MCP revisions (unchanged since 0.5.0) for servers
that reject even the current legacy pin. Protocol entry and `tools/list` get **one retry after ~800
ms** on a network-layer failure or timeout only — never on an HTTP error status (a 401/500 is a real
measurement). All post-entry calls carry the negotiated `protocolVersion` (and, for a stateful legacy
session, the negotiated session id). A hang on the unknown-method probe fails only C10.

`--json` also reports which protocol era was actually negotiated: `entry_method` (`server/discover` or
`initialize`), `protocol_revision`, `session_model` (`request_scoped` for modern; `stateful` or
`stateless_legacy` for legacy, depending on whether `initialize` actually issued a session id), and
`extensions` (modern protocol extension keys the server declared, `[]` otherwise). A compliant server
that speaks only the modern `server/discover` entry — with no `initialize` at all — can be graded since
0.7.0; earlier versions only ever attempted `initialize`.

It also runs an **advisory directory pre-flight** mapping to documented mechanical reject reasons for
the Claude Connectors and ChatGPT Apps directories (missing titles/annotations, promotional or generic
tool names, missing privacy-policy signal). About to submit? The [directory pre-flight guide](https://shigeki7777.github.io/sasame-mcp-observatory/preflight.html) lists what each directory checks — and what's out of scope (privacy-policy content, identity verification, OAuth), so you handle those yourself.

### Safety

`mcp-readiness` only calls tools that declare `readOnlyHint: true` (or, if none do, it probes the first
tool with **empty arguments only** — it never fabricates arguments for a tool whose safety is
undeclared, so it won't trigger a write). It never pays an x402 invoice; a priced tool is reported as
`delivery UNVERIFIED`, not failed.

## How the C7 / "ghost" check stays honest

A read-only tool that rejects synthetic arguments (input validation) is **not** a ghost — it's doing
its job. `mcp-readiness` samples up to three read-only tools and only reports "no real content" when a
tool returns empty on a genuine empty-args call. A validation error or a trivial echo of synthetic
input is reported as `UNVERIFIED`, never as a defect.

## Grade-over-time

`mcp-readiness` measures your server **right now** — something you can reproduce yourself. The
[**SaSame MCP Observatory**](https://live-vps.sasame.online/public-mcp) (free, no key) is the hosted
companion that has crawled and re-measured thousands of public MCP servers over time, so it can tell
you how a server's grade *moved* across days (improving / degrading), with ed25519-signed,
offline-verifiable certificates. This CLI runs the same criteria the Observatory uses.

## License & what's open vs. what's the service

The CLI is **MIT** — use it, fork it, sell it, wire it into your build. Copying the code is encouraged;
that's the point. The 10 criteria and the grading logic are open by design.

What forking the code *doesn't* give you is the hosted [SaSame MCP Observatory](https://live-vps.sasame.online/public-mcp):
the continuous re-measurement of thousands of public MCP servers over time, the longitudinal
grade-over-time history (improving / degrading), and the ed25519-**signed** certificates — anyone can
verify a certificate offline, but only SaSame *issues* them. This CLI grades a server **right now**
(something you can reproduce yourself); the Observatory is the service that remembers how it **moved**.

MIT © SaSame SRL.
