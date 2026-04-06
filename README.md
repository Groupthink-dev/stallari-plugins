<p align="center">
  <a href="https://marketplace.sidereal.cc">
    <img src="assets/sidereal-icon.png" width="128" alt="Sidereal">
  </a>
</p>

<h1 align="center">Sidereal Plugins</h1>

<p align="center">
  <a href="https://marketplace.sidereal.cc"><img src="https://img.shields.io/badge/marketplace-sidereal.cc-0066CC" alt="marketplace.sidereal.cc"></a>
  <img src="https://img.shields.io/badge/status-developer%20preview-orange" alt="Developer Preview">
  <img src="https://img.shields.io/badge/licence-Apache%202.0-green" alt="Apache 2.0">
</p>

Plugin and pack manifests for the [Sidereal](https://sidereal.cc) agentic platform. Service contract definitions, validation tooling, and contribution workflow.

## Overview

This repository manages two types of entries:

- **Plugins** (MCP tools) — JSON manifests in `plugins/tools/` declaring Model Context Protocol servers that implement service contracts.
- **Packs** (workflow bundles) — YAML manifests in `plugins/packs/` defining multi-agent skills, workflows, and automation pipelines.

Both are distributed through the [Sidereal Marketplace](https://marketplace.sidereal.cc).

## Service Contracts

Plugins implement versioned **service contracts** — abstract interfaces that let the platform swap providers without changing workflows. Contracts live in `schemas/contracts/` and define required, recommended, optional, and gated operations.

| Contract | Operations | Example Plugins |
|----------|------------|-----------------|
| `email-v1` | 13 | fastmail-blade-mcp, gmail-blade-mcp |
| `calendar-v1` | 8 | caldav-blade-mcp, google-calendar-mcp |
| `tasks-v1` | 11 | things-3-mcp, todoist-blade-mcp |
| `vault-v1` | 25 | sidereal-blade-mcp |
| `billing-v1` | 28 | paddle-billing-blade-mcp |
| `accounting-v1` | 39 | xero-blade-mcp |
| `ecommerce-v1` | 40 | shopify-blade-mcp |
| `drive-v1` | — | onedrive-blade-mcp |
| `notifications-v1` | — | resend-blade-mcp |

## Trust Tiers

Every plugin is classified into a trust tier:

| Tier | Meaning |
|------|---------|
| **Certified** | First-party, full conformance testing |
| **Verified** | Third-party, validated by maintainers |
| **Community** | Interest signal, untested conformance |

## Pack Spec

Packs follow the [Pack Spec](schemas/sidereal-pack.schema.json) (v1.0–v1.4). A pack declares agents, skills, workflows, service dependencies, data access, and user-configurable inputs.

```yaml
pack: "1.1"
name: daily-operations
version: "1.0.0"
description: Daily vault operations — digest, inbox processing, and email triage.

requires:
  services:
    - service: email
      operations: [search, read, snippets]
    - service: vault
      operations: [read, search, files]

data:
  reads: [email, calendar, tasks, vault]
  writes: [vault, tasks]
  stores: nothing
  phones_home: false

skills:
  - name: daily-digest
    agent: pkm-operator
    description: Generate a morning digest
    # ...
```

Packs can be **open** (source visible, forkable) or **sealed** (encrypted payload, licence-activated).

## Contributing

### Adding a plugin

1. **Fork this repo** and create a branch.

2. **Add a JSON manifest** in `plugins/tools/` named `your-plugin.json`. At minimum:

    ```json
    {
      "name": "your-plugin",
      "version": "1.0.0",
      "description": "What your MCP server does (max 200 chars)",
      "author": "your-github-handle",
      "licence": "MIT",
      "tier": "community",
      "contract": null,
      "repository": "https://github.com/you/your-plugin",
      "install": {
        "runtime": "uv",
        "package": "your-plugin"
      }
    }
    ```

    Set `contract` to a contract ID (e.g. `"email-v1"`) if your plugin implements one, or `null` if it doesn't map to an existing service domain. See `schemas/contracts/` for available contracts.

3. **Run validation** (optional but recommended):

    ```bash
    npm ci
    make validate
    node scripts/validate-plugin.js plugins/tools/your-plugin.json --update
    ```

    The `--update` flag writes a `certification` block into your manifest with checklist results.

4. **Open a pull request.** CI validates the manifest and runs conformance checks automatically.

### Adding a pack

1. Create a YAML manifest in `plugins/packs/` following the [Pack Spec schema](schemas/sidereal-pack.schema.json).
2. Validate locally: `make validate-packs`
3. Open a pull request.

### Validation checklist

The `validate-plugin.js` script runs automated checks:

| Check | Automated | Notes |
|-------|-----------|-------|
| Schema fields present | Yes | Required: name, version, description, author, licence, tier, install |
| Licence compatible | Yes | MIT, Apache-2.0, ISC, BSD, Unlicense |
| Installs cleanly | Yes | Spawns via declared runtime |
| Tools enumerate | Yes | Sends MCP `tools/list` over stdio JSON-RPC |
| Tools callable | Manual | Requires service-specific credentials |
| No data exfiltration | Manual | Network traffic review |
| Auth reviewed | Manual | Authentication model documented |

### Trust tiers and promotion

All external submissions enter at `tier: "community"`. Promotion path:

- **Community** — listed in marketplace, conformance untested
- **Verified** — maintainers have validated the plugin (install, enumeration, licence, security review)
- **Certified** — first-party plugins with full conformance testing against a service contract

### Sidecar manifest

If you'd like your plugin to participate in service routing (so packs can reference abstract operations like `{{email.search}}` and have them resolve to your tool), add a `sidereal-plugin.yaml` to your repo root with a `services` block:

```yaml
services:
  email:
    search: my_search_tool
    read: my_read_tool
    # maps contract operations → your MCP tool names
```

See the [plugin schema](schemas/sidereal-plugin.schema.json) for the full spec.

## Local Development

```bash
npm ci                    # Install deps (yaml parser)
make validate-all         # Validate plugin + pack manifests
make build-api            # Build catalog (plugins/ → dist/)
make test                 # Run build-script tests
make contracts            # List contracts with operation counts
```

## Licence

[Apache 2.0](LICENSE) — use freely with attribution.
