# mcp-readiness

**Lighthouse for MCP servers.** Point it at any public [Model Context Protocol](https://modelcontextprotocol.io) server and get a graded readiness report in ~2 seconds — handshake, tool quality, safety annotations, anti-ghost content, token efficiency, honest errors — plus a Claude/ChatGPT directory pre-flight.

Zero dependencies. Zero config. Zero telemetry. Runs anywhere Node 18+ runs.

```bash
npx mcp-readiness https://mcp.example.com/mcp
```

A real run — a strong server that's **one fix from a clean directory pre-flight** (one criterion to address, not a verdict on your work):

```
  MCP Readiness    B    9/10 criteria  ·  11 tools  ·  134ms
  https://mcp.example.com/mcp

  PASS  C1 Protocol handshake conformance
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
- run: npx mcp-readiness "$MCP_URL"     # exit 0 = A/B, 1 = C/D, 2 = connection/usage error
```

```bash
npx mcp-readiness <url> --json          # machine-readable full report
```

## The 10 criteria

Each is bound to the MCP spec or a direct measurement — not taste. Grade: **A** ≥10 · **B** ≥8 · **C** ≥5 · **D** below. (A server that never returns verifiable content is capped at **B** — honesty cap.)

| | Criterion | Bound to |
|---|---|---|
| C1 | Protocol handshake conformance | `initialize` returns `protocolVersion` + `capabilities` |
| C2 | Tool listability | `tools/list` returns `result.tools[]` |
| C3 | Tool object validity | valid name + non-empty description + typed `inputSchema` |
| C4 | Description sufficiency | every desc ≥12 chars, median ≥20, ≥60% distinct |
| C5 | Safety annotation presence | a boolean hint (`readOnlyHint`/`destructiveHint`/…) on ≥50% of tools |
| C6 | Liveness & latency | 2xx `initialize` < 5000 ms |
| C7 | Returns real content (anti-ghost) | a read-only tool returns substantive, non-echo content; priced/x402 → UNVERIFIED |
| C8 | Machine-discoverable identity | `serverInfo` name + version |
| C9 | Token efficiency | `tools/list` payload < 40 KB |
| C10 | Honest error behavior | unknown method → structured JSON-RPC error, not a hang |

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
