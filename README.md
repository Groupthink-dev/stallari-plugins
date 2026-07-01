<p align="center">
  <a href="https://marketplace.stallari.app">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/stallari-logo-dark.png">
      <img src="assets/stallari-logo-light.png" alt="Stallari" width="320">
    </picture>
  </a>
</p>

<h1 align="center">Stallari Plugins</h1>

<p align="center">
  <a href="https://marketplace.stallari.app"><img src="https://img.shields.io/badge/marketplace-stallari.app-0066CC" alt="marketplace.stallari.app"></a>
  <a href="https://github.com/Groupthink-dev/stallari-plugins/discussions"><img src="https://img.shields.io/github/discussions/Groupthink-dev/stallari-plugins?label=discussions" alt="Discussions"></a>
  <img src="https://img.shields.io/badge/status-developer%20preview-orange" alt="Developer Preview">
  <img src="https://img.shields.io/badge/license-Apache%202.0-green" alt="Apache 2.0">
</p>

`stallari-plugins` is the public catalog metadata repository for the Stallari Marketplace. It describes the artifacts the registry and app can list, validate, install, and present: MCP plugins, packs, add-ons, and bundles.

The schemas and vocabulary in this repo are synchronized from `stallari-pack-spec`; treat that sibling repo as the source of truth for schema evolution.

## Catalog Shape

| Artifact | Directory | Purpose |
|---|---|---|
| MCP plugins | `plugins/tools/*.json` | Tool/provider catalog entries, install instructions, contracts, tools, trust/readiness metadata |
| Packs | `plugins/packs/` | Marketplace metadata for workflow packs; first-party pack content lives in `stallari-packs` |
| Add-ons | `plugins/add-ons/` | UI reveal and scoped credential provisioning artifacts |
| Bundles | `plugins/bundles/` | Install/remove/version units that couple related packs, plugins, and add-ons |
| Scan exceptions | `plugins/scan-exceptions/` | Reviewed catalog scanner exceptions |
| Schemas | `schemas/` | Synced schema and vocabulary artifacts consumed by catalog build tooling |

Current catalog state includes dozens of MCP provider manifests across email, calendar, tasks, vault, DNS, storage, billing, home, travel, gaming, network, infrastructure, and other service domains.

## Contracts, Trust, And Readiness

Plugins may implement versioned service contracts such as `email-v1`, `calendar-v1`, `vault-v1`, `billing-v1`, `home-v1`, `gpu-inference-v1`, or `dns-authoritative-v1`. Contracts let packs ask for an abstract service operation while the runtime resolves an installed provider.

Catalog metadata also carries:

- trust tier: `certified`, `verified`, or `community`
- readiness/certification signals for marketplace presentation
- per-tool risk class and granularity declarations
- domain-scope and non-conformance rationale where applicable
- install runtime/package metadata
- vendor/repository/setup links

## Local Development

```bash
npm ci
make validate-all
make build-api
make test
make contracts
```

Run validation before opening catalog PRs. Validation covers JSON/YAML parsing, schema conformance, contract metadata, catalog build scripts, and scanner checks where configured.

## Privacy, Secrets, And PII

Catalog entries and examples must never include real API keys, tokens, account IDs, email addresses, customer names, hostnames, vault paths, diagnostic payloads, or user data. Use placeholders and setup guidance instead. If a provider requires credentials, document the credential label and minimum scope, not the credential value.

## Related Repos

| Repo | Role |
|---|---|
| `stallari-pack-spec` | Schema, vocabulary, service contracts, add-on/bundle definitions |
| `stallari-packs` | First-party pack content and tarball publish source |
| `stallari-registry-infra` | Registry API, marketplace site, sealed pack verification, and public catalog deploy |
| `stallari-harness` | Runtime consumer of catalog, pack install API, local tool and add-on behaviour |

## License

[Apache 2.0](LICENSE) - use freely with attribution.
