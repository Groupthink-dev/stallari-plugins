# Contributing to Stallari Plugins

Thanks for your interest in contributing to the Stallari plugin ecosystem.

## Before you start

- Browse the [Discussions](https://github.com/Groupthink-dev/stallari-plugins/discussions) — your question may already be answered
- Read the [Getting Started](https://github.com/Groupthink-dev/stallari-plugins/discussions/3) guide for pack authoring basics
- Look at [`meeting-intelligence`](plugins/packs/meeting-intelligence.yaml) as a worked example of a community-contributed pack

## Submitting a plugin or pack

Technical details (manifest format, validation, schema references) are in the [README](README.md#contributing). The short version:

1. **Fork** this repo
2. **Add your manifest** — JSON in `plugins/tools/` for plugins, YAML in `plugins/packs/` for packs
3. **Validate** — `npm ci && make validate-all`
4. **Open a PR** — CI runs checks automatically

All external submissions enter at `tier: "community"`. See the README for the promotion path to Verified and Certified.

## What to expect from review

- We aim to triage new PRs within a few days
- Automated checks run on every PR (schema validation, license compatibility)
- A maintainer will review for manifest correctness, data declarations, and security posture
- We may ask clarifying questions — this is collaborative, not adversarial

## Questions and ideas

- **Stuck on something?** Ask in [Pack Development](https://github.com/Groupthink-dev/stallari-plugins/discussions/categories/pack-development) — it's a Q&A board, so answers can be marked as resolved
- **Built something?** Share it in [Show and Tell](https://github.com/Groupthink-dev/stallari-plugins/discussions/categories/show-and-tell)
- **Have a feature idea?** Post in [Ideas](https://github.com/Groupthink-dev/stallari-plugins/discussions/categories/ideas)

## Code of conduct

Be constructive and respectful. We're building this ecosystem together.
