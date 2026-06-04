# `plugins/packs/` — retired (DD-346 Phase E)

This directory **no longer holds per-pack YAML copies.**

Pack content has a single source of truth: the canonical
[`groupthink-dev/stallari-packs`](https://github.com/groupthink-dev/stallari-packs)
repository. The marketplace catalog is now a clean, repeatable **projection** of
canonical `stallari-packs` at one pinned SHA — read directly by
`scripts/build-catalog.js` and `scripts/build-forge-context.js` via
`scripts/lib/canonical-packs.js`.

- **The pin** lives in `../../PACKS_SHA` (40-hex). Repin = edit that one file.
- **The checkout** defaults to `../stallari-packs` (override with
  `STALLARI_PACKS_DIR`). `STRICT_PACKS_PIN=1` hard-fails on HEAD/pin drift
  (used by the deploy path).
- **Skill content** (`import: ./skills/*.md`) is resolved for the marketplace
  display surface (`pack-details.json`); the integrity digest stays
  manifest-level to match the harness `PackIntegrity.computeDigest(manifest:)`.

The former drifted, hand-pinned copies (and the ghost `meeting-intelligence.yaml`,
which was never installable) were removed here. Pack **validation** is owned by
`stallari-packs` (`scripts/validate.js` + the secops scanner `S-SKL-001`), not
this repo.

See `[[DD-346]]` Phase E and `[[DD-346-implementation-plan]]`.
