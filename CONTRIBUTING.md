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

## Operators — reuse vs declare custom

Stallari ships a fixed palette of ten platform operator personas
(`pkm-operator`, `comms-operator`, `scheduling-operator`, `secops-operator`,
`fleet-operator`, `notifications-operator`, `home-operator`,
`bizops-operator`, `review-operator`, `memory-operator`) plus two
harness-only personas (`digital-assistant`, `system-architect`).

When you author a skill, you have two options:

**Reuse a platform operator (encouraged)** — reference one of the ten by
bare name in your skill's `agent:` field. No `agents:` block needed; the
harness routes your skill to the platform's persona at dispatch time.

```yaml
skills:
  - name: my-skill
    agent: comms-operator     # bare-name reuse — no `agents:` block
    description: "..."
    prompt: "..."
```

This is the right move when an operator's posture (see
[platform-operators.md](https://github.com/Groupthink-dev/stallari-doc/blob/main/public-docs/operators/platform-operators.md))
matches your skill. It keeps user experience consistent across packs.

**Declare a custom persona** — when your skill needs a posture that doesn't
match any platform operator, declare a new agent under a non-reserved
name. The compiler namespaces it to `<your-pack-name>/<agent-name>` so
collisions across packs are impossible.

```yaml
agents:
  meeting-processor:
    role: operator
    prompt: |
      You process meetings — extract action items, decisions, attendees.
skills:
  - name: process-meeting
    agent: meeting-processor
    description: "..."
```

**What is rejected** — redefining a platform operator. Pack-spec's schema
validator rejects this with `reserved-agent-name`:

```yaml
# Rejected — comms-operator is a reserved platform name (DD-222)
agents:
  comms-operator:
    role: operator
    prompt: "I claim to be comms-operator."
```

If the platform persona doesn't fit your domain, the right move is a
custom namespaced persona — not shadowing a reserved name. If the
platform persona is missing context your skill needs, put that context in
the *skill prompt itself*; the operator persona stays platform-owned.

See [stallari-pack-spec's `docs/operators-v1.md`](https://github.com/Groupthink-dev/stallari-pack-spec/blob/main/docs/operators-v1.md)
for the normative spec, and `fixtures/valid/reuse-platform-operator.yaml`
for a worked example.

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
