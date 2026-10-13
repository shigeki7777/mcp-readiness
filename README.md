# mcp-readiness

**Lighthouse for MCP servers.** Grade a public Model Context Protocol server against 10 spec-bound readiness criteria from the command line, in CI, or as a GitHub Action.

`mcp-readiness` is a SaSame capability for MCP readiness. It is not SaSame's company-wide product identity. The current SaSame front door is **GEC (Global Ecosystem)**:

- Explore Projects
- Browse OPEN Demands and paid work
- Start a Project or post a Demand
- Connect an agent
- Review verified completed outcomes / Success Cases

**GEC:** <https://sasame.online/gec>

The hosted MCP Observatory and the legacy Gold Rush commands documented below remain supported capability/compatibility surfaces where stated. They are not the current company-wide SaSame handoff.

## Quick start

```bash
npx mcp-readiness https://mcp.example.com/mcp
```

Audit a local server while developing:

```bash
npx mcp-readiness http://localhost:3000/mcp
```

Machine-readable output:

```bash
npx mcp-readiness https://mcp.example.com/mcp --json --no-color
```

Global install is optional:

```bash
npm i -g mcp-readiness
mcp-readiness https://mcp.example.com/mcp
```

No SaSame API key, payment credential, wallet credential, or secret is required to run the readiness audit.

## What it checks

The CLI grades 10 readiness criteria:

1. **Protocol entry** — the server can negotiate a supported MCP entry path.
2. **Tool listability** — tools can be enumerated.
3. **Tool validity** — tool schemas are structurally usable.
4. **Description quality** — tools contain useful human/agent-readable descriptions.
5. **Safety annotations** — annotations communicate behavioral expectations where applicable.
6. **Liveness** — the protocol entry completes within the readiness bound.
7. **Real content / anti-ghost** — a tool call returns meaningful content instead of a hollow success.
8. **Machine identity** — the endpoint exposes usable server identity information.
9. **Token efficiency** — the tool surface is reasonably economical for agents to ingest.
10. **Honest errors** — unsupported or invalid requests fail honestly rather than pretending to succeed.

It also emits an advisory Claude/ChatGPT directory pre-flight. The pre-flight is not a security certification or listing guarantee.

Grades:

- **A**: 10/10
- **B**: 8–9
- **C**: 5–7
- **D**: below 5 or an honesty/liveness boundary that prevents a higher truthful grade

## Protocol behavior

Current releases use dual-stack MCP entry negotiation. The client attempts the modern discovery path where supported and falls back through the bounded legacy negotiation path when appropriate.

The readiness decision tree is designed to avoid false-negative D grades caused solely by protocol-era differences. Tests cover modern discovery, legacy initialization, revision fallback, and canonical negotiation parity.

## JSON output and SaSame handoff

`--json` includes the audit result plus an `activation` object. In 0.8.0 the company-wide handoff is explicitly GEC:

```json
{
  "activation": {
    "baseline_url": "https://live-vps.sasame.online/observatory/check/",
    "gec_url": "https://sasame.online/gec",
    "gec_name": "SaSame Global Ecosystem (GEC)",
    "participation": "Projects, OPEN Demands, paid work, agent participation, verified outcomes"
  }
}
```

The old Capability Control Beta / retired-domain handoff fields were removed in 0.8.0 rather than kept as misleading aliases.

## Hosted readiness capability

The local CLI is reproducible and forkable. SaSame also exposes hosted MCP readiness/observation capability for grade-over-time and ownership evidence.

Public MCP / readiness entry:

<https://live-vps.sasame.online/public-mcp>

Readiness baseline:

<https://live-vps.sasame.online/observatory/check/>

If a readiness check is wrong or unfair to a server, open an issue here rather than treating the grade as unquestionable truth:

<https://github.com/shigeki7777/mcp-readiness/issues>

A readiness grade is **not** a malware scan, endorsement, paid ranking, custody relationship, regulatory certification, or tax document.

## GitHub Action

Example:

```yaml
name: MCP readiness

on:
  push:
  pull_request:

jobs:
  readiness:
    runs-on: ubuntu-latest
    steps:
      - uses: shigeki7777/mcp-readiness@main
        with:
          url: https://mcp.example.com/mcp
```

For reproducible production CI, pin the action to a release tag or commit instead of `main`.

## Exit codes

- `0` — grade A/B, or successful legacy Gold Rush command
- `1` — grade C/D, unreachable-D, or a Gold Rush tool result with `ok:false`
- `2` — usage/client error

## Legacy compatibility: Gold Rush v1

Gold Rush v1 remains available for existing scripts. It is **legacy compatibility and measurement**, not SaSame's current company-wide product identity.

```bash
npx mcp-readiness gold-rush start <mcp-url> [--goal <preset>]
npx mcp-readiness gold-rush status <package-id>
npx mcp-readiness gold-rush run <package-id>
npx mcp-readiness gold-rush report <package-id>
```

Use `--json` for machine-readable output and `--endpoint <url>` to target another compatible SaSame public MCP endpoint.

The Gold Rush compatibility path does not imply payment, commercial availability, endorsement, or organic market validation.

## Security and privacy boundaries

The CLI does not intentionally read SaSame tokens, npm tokens, GitHub tokens, API keys, bearer tokens, passwords, private keys, or wallet secrets. The readiness client is intended for public MCP endpoints and local development endpoints supplied by the operator.

Do not point the tool at systems you are not authorized to test. A readiness audit is not a substitute for a security review.

## Relationship to GEC

MCP readiness is one capability that can be used by Projects and providers participating in GEC. For SaSame-wide participation, discovery, work, and verified outcomes, use the canonical GEC surface:

<https://sasame.online/gec>

That distinction is intentional:

- **GEC** = company-wide Projects / Demands / paid work / agent participation / verified outcomes.
- **mcp-readiness** = MCP readiness audit capability.
- **Observatory** = hosted readiness/observation capability.
- **Gold Rush v1** = legacy compatibility commands retained for existing integrations.

## License

MIT. See [LICENSE](LICENSE).
