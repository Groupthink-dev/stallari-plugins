---
kind: shim
project: stallari-plugins
shim_version: 1.0.0
deployed_to:
  - "~/src/stallari-plugins/CLAUDE.md (Claude Code)"
canonical: "[[atlas/utilities/agent-harness/boot/stallari-plugins.CLAUDE]]"
last_updated: 2026-04-07T12:37:03+10:00
publish: false
llm_generated: true
llm_model: claude-opus-4-6
llm_date: 2026-04-07
related:
  - "[[atlas/utilities/agent-harness/directives/system-architect]]"
  - "[[atlas/utilities/agent-harness/state/system-architect]]"
---
# Stallari Plugins — Session Boot Loader

@/Users/piers/master-ai/atlas/utilities/agent-harness/directives/access-policy.md

## Project

Public plugin content repository for Stallari. Contains pack YAML definitions,
asset bundles, schemas, and build tooling for the plugin catalog.

**Split from `stallari-registry-infra`** — this repo owns *content* (pack
definitions, skill metadata, asset images). The registry-infra repo owns
*infrastructure* (API worker, marketplace site, R2 deployment).

## Structure

```
stallari-plugins/
├── plugins/              # Pack YAML definitions (one dir per pack)
├── assets/               # Pack icons, screenshots
├── data/                 # Generated data files
├── schemas/              # JSON Schema for pack YAML validation
├── scripts/
│   ├── build-catalog.js      # Generates dist/catalog.json
│   ├── build-forge-context.js # Generates forge context for LLM
│   └── generated/             # Build output (declared-services.js)
└── dist/                 # Build output (catalog.json, services.json)
```

## Build

```bash
npm ci
node scripts/build-catalog.js        # Build catalog from pack YAMLs
node scripts/build-forge-context.js  # Build forge context
```

Output in `dist/` is deployed to R2 by `stallari-registry-infra`.

## Pack YAML spec

Schema in `schemas/`. Format defined by `stallari-pack-spec`. Each pack YAML
declares skills, graph methodology, services, and sealed status.

Current state: 53 skills across 8 open packs (Pack Spec v1.6). Sealed packs
are in a separate private repo (`stallari-packs-private`).

## Conventions

- Pack YAMLs must validate against the schema before commit
- `dist/` is gitignored — built by CI or manually before deploy
- Asset images use consistent naming: `{pack-id}/{icon|screenshot-N}.png`
- Skill IDs are globally unique across all packs

## Repo owner

`system-architect` — pack schema design, catalog build tooling.
