/**
 * Canonical pack loader — single source of truth for the marketplace catalog.
 *
 * DD-346 Phase E. The marketplace catalog is a clean, repeatable projection of
 * canonical `stallari-packs` at one pinned SHA. This module is the ONE place
 * that reads `stallari-packs/packs/<slug>/pack.yaml` (+ resolves `import:`
 * skills for display) so that both `build-catalog.js` and
 * `build-forge-context.js` share identical loading semantics. The former
 * inlined `plugins/packs/*.yaml` copies (drifted, hand-pinned) are retired.
 *
 * Layout read:  <packsRoot>/packs/<slug>/{pack.yaml, skills/*.md, payload.enc, seal-key.hex}
 * Pin:          <pluginsRoot>/PACKS_SHA (40-hex) drives BOTH which content is
 *               read AND the `source.commit` stamped on every non-alpha entry.
 *
 * Sealed packs (e.g. stallari-private-cloud) carry `payload.enc` + `seal-key.hex`
 * alongside a JSON `pack.yaml`; they are returned with `sealed: true` and their
 * artifacts copied verbatim by the caller (NEVER re-stringified — that would
 * break seal_metadata.descriptor_hash). Sealed packs install via the registry
 * manifest+payload path, not the `source.commit` tarball path, so they are not
 * `source`-stamped.
 *
 * Alpha stubs (`readiness: alpha`, no `skills:`) are INCLUDED as catalog
 * entries (Decision Q1) but left `source: null` so the harness never attempts a
 * tarball fetch — they surface as coming-soon, non-installable cards.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

/** Resolve the canonical stallari-packs checkout root. */
export function resolvePacksRoot(pluginsRoot) {
  if (process.env.STALLARI_PACKS_DIR) {
    return resolve(process.env.STALLARI_PACKS_DIR);
  }
  return resolve(pluginsRoot, "..", "stallari-packs");
}

/** Read the pinned stallari-packs SHA from <pluginsRoot>/PACKS_SHA (or null). */
export async function readPin(pluginsRoot) {
  try {
    const raw = await readFile(join(pluginsRoot, "PACKS_SHA"), "utf-8");
    const pin = raw.trim();
    return /^[0-9a-f]{40}$/.test(pin) ? pin : (pin || null);
  } catch {
    return null;
  }
}

/**
 * Assert the canonical checkout HEAD matches the pin. Reads the working tree
 * (matching the harness `vendor-packs` discipline) so a mismatch means the
 * content would not match the stamped `source.commit`.
 *
 * Default: loud warning + proceed (keeps the JS test suite green when a runner
 * has a stray-SHA sibling). Set STRICT_PACKS_PIN=1 (deploy path) to hard-fail.
 */
function checkPin(packsRoot, pin) {
  if (!pin) return;
  let head;
  try {
    head = execFileSync("git", ["-C", packsRoot, "rev-parse", "HEAD"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    return; // not a git checkout — nothing to assert
  }
  if (head === pin) return;
  const msg =
    `stallari-packs HEAD is ${head}, pinned to ${pin} (PACKS_SHA).\n` +
    `       catalog content would not match the stamped source.commit.\n` +
    `       cd ${packsRoot} && git checkout ${pin}`;
  if (process.env.STRICT_PACKS_PIN === "1") {
    throw new Error(`Pin mismatch — ${msg}`);
  }
  console.warn(`  ⚠ Pin mismatch — ${msg}`);
}

/** Split a markdown file into (frontmatterYAML|null, body). Mirrors the
 * harness PackCompiler.splitMarkdownFrontmatter byte-for-byte. */
export function splitMarkdownFrontmatter(content) {
  const lines = content.split("\n");
  if ((lines[0] ?? "").trim() !== "---") return { frontmatter: null, body: content };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) return { frontmatter: null, body: content };
  return {
    frontmatter: lines.slice(1, close).join("\n"),
    body: lines.slice(close + 1).join("\n"),
  };
}

/**
 * Resolve a skill's display fields. For `import:` skills, read the SKILL.md
 * frontmatter (description, name) and body; pack.yaml entry fields win on
 * collision (DD-234 merge precedence). For inline skills, pass through.
 *
 * NOTE: resolved prompts feed the DISPLAY surface (pack-details.json) only.
 * They are NOT fed into computeCanonicalDigest, which stays manifest-level and
 * must match PackIntegrity.computeDigest(manifest:) (import skills excluded).
 */
async function resolveSkillDisplay(skill, packDir) {
  if (skill && typeof skill.import === "string") {
    const norm = skill.import.startsWith("./") ? skill.import.slice(2) : skill.import;
    const filenameBase = basename(norm, ".md");
    let fm = {};
    if (!norm.startsWith("/") && !norm.includes("..") && norm.endsWith(".md")) {
      try {
        const raw = await readFile(join(packDir, norm), "utf-8");
        const { frontmatter } = splitMarkdownFrontmatter(raw);
        if (frontmatter) fm = parseYaml(frontmatter) || {};
      } catch {
        /* missing/unparseable SKILL.md — fall back to filename-derived name */
      }
    }
    return {
      name: skill.name ?? fm.name ?? filenameBase,
      description: skill.description ?? fm.description ?? null,
      agent: skill.agent ?? fm.agent ?? null,
      category: skill.category ?? fm.category ?? null,
      trigger: skill.trigger ?? fm.trigger ?? null,
    };
  }
  return {
    name: skill?.name ?? null,
    description: skill?.description ?? null,
    agent: skill?.agent ?? null,
    category: skill?.category ?? null,
    trigger: skill?.trigger ?? null,
  };
}

/**
 * Load every canonical pack from <packsRoot>/packs/. Returns an array of
 * `{ manifest, sealed, sourceDir, sealedManifestFilename, slug, displaySkills }`.
 *
 * - manifest:   raw parsed pack.yaml (import form preserved — feeds catalog
 *               entry + computeCanonicalDigest + dist manifest), with `source`
 *               re-stamped (repo+pin for normal packs, null for alpha/sealed).
 * - displaySkills: import-resolved skill display rows for pack-details.json.
 */
export async function loadCanonicalPacks(pluginsRoot) {
  const packsRoot = resolvePacksRoot(pluginsRoot);
  const pin = await readPin(pluginsRoot);
  const packsContainer = join(packsRoot, "packs");

  let slugs;
  try {
    slugs = await readdir(packsContainer);
  } catch {
    // AUD-03-01: on the deploy path (STRICT_PACKS_PIN=1) a missing canonical
    // checkout must fail the build — a soft [] here ships a packs:0 catalog
    // that 404s every install while looking healthy at every later gate.
    if (process.env.STRICT_PACKS_PIN === "1") {
      throw new Error(
        `Canonical stallari-packs not found at ${packsContainer} — refusing to build a packs-empty catalog under STRICT_PACKS_PIN. Set STALLARI_PACKS_DIR to a checkout at the PACKS_SHA pin.`,
      );
    }
    console.warn(
      `  ⚠ Canonical stallari-packs not found at ${packsContainer} — building catalog with plugins only. Set STALLARI_PACKS_DIR or clone the sibling.`,
    );
    return [];
  }

  checkPin(packsRoot, pin);

  const packs = [];
  for (const slug of slugs.sort()) {
    const packDir = join(packsContainer, slug);
    const dirStat = await stat(packDir).catch(() => null);
    if (!dirStat?.isDirectory()) continue;

    const packYamlPath = join(packDir, "pack.yaml");
    let manifest;
    try {
      manifest = parseYaml(await readFile(packYamlPath, "utf-8"));
    } catch {
      console.warn(`  ⚠ Skipping ${slug}: no readable pack.yaml`);
      continue;
    }
    if (!manifest || !manifest.pack || !manifest.name || !manifest.version) {
      console.warn(`  ⚠ Skipping ${slug}: missing required fields (pack, name, version)`);
      continue;
    }

    const sealed =
      (await stat(join(packDir, "payload.enc")).catch(() => null)) &&
      (await stat(join(packDir, "seal-key.hex")).catch(() => null));

    if (sealed) {
      // Sealed pack — installs via the registry manifest + payload path, not a
      // source.commit tarball. Null the catalog entry's source (retires the
      // stale aspirational `vault` source). The dist manifest.json is copied
      // VERBATIM from pack.yaml below, so descriptor_hash is untouched.
      manifest.source = null;
      packs.push({
        manifest,
        sealed: true,
        sourceDir: packDir,
        sealedManifestFilename: "pack.yaml",
        slug,
        displaySkills: (manifest.skills || []).map((s) => ({
          name: s.name ?? null,
          description: s.description ?? null,
          agent: s.agent ?? null,
          category: s.category ?? null,
          trigger: s.trigger ?? null,
        })),
      });
      continue;
    }

    const isAlpha = manifest.readiness === "alpha";
    if (!Array.isArray(manifest.skills) && !isAlpha) {
      console.warn(`  ⚠ ${slug}: no skills[] and not readiness:alpha — including anyway`);
    }

    // Re-stamp source: single pin drives source.commit. Alpha stubs stay
    // source:null so the harness never attempts a (content-less) tarball fetch.
    manifest.source = isAlpha
      ? null
      : { type: "repo", repo: "groupthink-dev/stallari-packs", path: `packs/${slug}/`, commit: pin };

    const displaySkills = [];
    for (const skill of manifest.skills || []) {
      displaySkills.push(await resolveSkillDisplay(skill, packDir));
    }

    packs.push({ manifest, sealed: false, sourceDir: null, slug, displaySkills });
  }

  return packs;
}
