#!/usr/bin/env node
/**
 * Validate all pack YAML manifests in plugins/packs/ against the
 * Pack Spec v1.0/v1.1/v1.2 rules. Mirrors worker/src/validate.ts logic.
 *
 * Usage: node scripts/validate-packs.js
 * Exit code: 0 if all valid, 1 if any errors found.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { DECLARED_SERVICES } from "./generated/declared-services.js";

const ROOT = resolve(import.meta.dirname, "..");
const PACKS_DIR = join(ROOT, "plugins", "packs");

const VALID_PACK_VERSIONS = ["1.0", "1.1", "1.2", "1.3", "1.4"];
const VALID_VISIBILITIES = ["open", "sealed"];
const VALID_ACCESS = ["public", "private"];
const VALID_DATA_STORES = ["nothing", "local", "remote"];
const VALID_TIERS = ["certified", "verified", "community"];
const VALID_PRICING_MODELS = ["free", "tip", "one-time", "subscription"];
const VALID_KEY_DELIVERY = ["paddle", "registry-escrow", "direct"];
const SEALED_ALLOWED_TIERS = ["certified", "verified"];
const VALID_SKILL_CATEGORIES = ["ingest", "triage", "digest", "transform", "notify", "review", "sync", "report"];

function validatePack(parsed) {
  const errors = [];

  if (!parsed || typeof parsed !== "object") {
    return ["Manifest must be a YAML mapping"];
  }

  // pack version
  if (!parsed.pack) {
    errors.push('Missing required field: "pack"');
  } else if (!VALID_PACK_VERSIONS.includes(String(parsed.pack))) {
    errors.push(`Unsupported pack version: "${parsed.pack}" (expected: ${VALID_PACK_VERSIONS.join(", ")})`);
  }

  // name
  if (!parsed.name || typeof parsed.name !== "string") {
    errors.push('Missing required field: "name"');
  }

  // description
  if (!parsed.description || typeof parsed.description !== "string") {
    errors.push('Missing required field: "description"');
  }

  // author
  if (parsed.author !== undefined) {
    if (typeof parsed.author !== "object" || parsed.author === null) {
      errors.push('"author" must be an object with "name"');
    } else if (!parsed.author.name || typeof parsed.author.name !== "string") {
      errors.push("author.name is required");
    }
  }

  // min_sidereal
  if (parsed.min_sidereal !== undefined) {
    if (!/^\d+\.\d+$/.test(String(parsed.min_sidereal))) {
      errors.push(`Invalid min_sidereal format: "${parsed.min_sidereal}" (expected "X.Y")`);
    }
  }

  // data block
  if (!parsed.data || typeof parsed.data !== "object") {
    errors.push('Missing required field: "data"');
  } else {
    const { reads, writes, stores, phones_home } = parsed.data;
    if (!Array.isArray(reads)) {
      errors.push("data.reads must be an array");
    } else {
      for (const s of reads) {
        if (!DECLARED_SERVICES.includes(s)) errors.push(`Unknown service "${s}" in data.reads`);
      }
    }
    if (!Array.isArray(writes)) {
      errors.push("data.writes must be an array");
    } else {
      for (const s of writes) {
        if (!DECLARED_SERVICES.includes(s)) errors.push(`Unknown service "${s}" in data.writes`);
      }
    }
    if (stores === undefined) {
      errors.push("data.stores is required");
    } else if (!VALID_DATA_STORES.includes(String(stores))) {
      errors.push(`Invalid data.stores: "${stores}"`);
    }
    if (phones_home === undefined) {
      errors.push("data.phones_home is required");
    } else if (typeof phones_home !== "boolean") {
      errors.push("data.phones_home must be a boolean");
    }
  }

  // skills
  if (!Array.isArray(parsed.skills) || parsed.skills.length === 0) {
    errors.push('"skills" must be a non-empty array');
  } else {
    const names = new Set();
    for (let i = 0; i < parsed.skills.length; i++) {
      const skill = parsed.skills[i];
      if (!skill || typeof skill !== "object") { errors.push(`skills[${i}] must be an object`); continue; }
      if (!skill.name || typeof skill.name !== "string") errors.push(`skills[${i}].name is required`);
      else { if (names.has(skill.name)) errors.push(`Duplicate skill name: "${skill.name}"`); names.add(skill.name); }
      if (!skill.prompt || typeof skill.prompt !== "string") errors.push(`skills[${i}].prompt is required`);
      // category (v1.2)
      if (skill.category !== undefined) {
        if (!VALID_SKILL_CATEGORIES.includes(String(skill.category))) {
          errors.push(`skills[${i}].category "${skill.category}" is invalid. Must be: ${VALID_SKILL_CATEGORIES.join(", ")}`);
        }
      }
      // services_used (v1.2)
      if (skill.services_used !== undefined) {
        if (!Array.isArray(skill.services_used)) {
          errors.push(`skills[${i}].services_used must be an array`);
        } else {
          for (let j = 0; j < skill.services_used.length; j++) {
            const su = skill.services_used[j];
            if (!su || typeof su !== "object") { errors.push(`skills[${i}].services_used[${j}] must be an object`); continue; }
            if (!su.service || typeof su.service !== "string") {
              errors.push(`skills[${i}].services_used[${j}].service is required`);
            } else if (!DECLARED_SERVICES.includes(su.service)) {
              errors.push(`Unknown service "${su.service}" in skills[${i}].services_used`);
            }
            if (su.operations !== undefined && !Array.isArray(su.operations)) {
              errors.push(`skills[${i}].services_used[${j}].operations must be an array`);
            }
          }
        }
      }
      // webhook_name (v1.4)
      if (skill.webhook_name !== undefined) {
        if (typeof skill.webhook_name !== "string" || !skill.webhook_name) {
          errors.push(`skills[${i}].webhook_name must be a non-empty string`);
        }
      }
      // trigger.webhook (v1.4)
      if (skill.trigger !== undefined) {
        if (typeof skill.trigger !== "object" || skill.trigger === null) {
          errors.push(`skills[${i}].trigger must be an object`);
        } else if (skill.trigger.webhook !== undefined) {
          const wh = skill.trigger.webhook;
          if (typeof wh !== "object" || wh === null) {
            errors.push(`skills[${i}].trigger.webhook must be an object`);
          } else {
            if (!wh.path || typeof wh.path !== "string") {
              errors.push(`skills[${i}].trigger.webhook.path is required`);
            }
            if (wh.auth !== undefined && typeof wh.auth !== "string") {
              errors.push(`skills[${i}].trigger.webhook.auth must be a string`);
            }
          }
        }
      }
      // inputs (v1.2)
      if (skill.inputs !== undefined && !Array.isArray(skill.inputs)) {
        errors.push(`skills[${i}].inputs must be an array`);
      }
      // outputs (v1.2)
      if (skill.outputs !== undefined) {
        if (!Array.isArray(skill.outputs)) {
          errors.push(`skills[${i}].outputs must be an array`);
        } else {
          for (let j = 0; j < skill.outputs.length; j++) {
            const out = skill.outputs[j];
            if (!out || typeof out !== "object") { errors.push(`skills[${i}].outputs[${j}] must be an object`); continue; }
            if (!out.type || typeof out.type !== "string") errors.push(`skills[${i}].outputs[${j}].type is required`);
          }
        }
      }
    }
  }

  // requires/recommends
  for (const field of ["requires", "recommends"]) {
    const block = parsed[field];
    if (!block || typeof block !== "object") continue;
    if (!Array.isArray(block.services)) continue;
    for (let i = 0; i < block.services.length; i++) {
      const svc = block.services[i];
      if (!svc?.service) { errors.push(`${field}.services[${i}].service is required`); continue; }
      if (!DECLARED_SERVICES.includes(svc.service)) {
        errors.push(`Unknown service "${svc.service}" in ${field}.services`);
      }
    }
  }

  // visibility
  if (parsed.visibility !== undefined && !VALID_VISIBILITIES.includes(String(parsed.visibility))) {
    errors.push(`Invalid visibility: "${parsed.visibility}"`);
  }

  // tier (v1.1)
  if (parsed.tier !== undefined && !VALID_TIERS.includes(String(parsed.tier))) {
    errors.push(`Invalid tier: "${parsed.tier}"`);
  }

  // pricing (v1.1)
  if (parsed.pricing !== undefined && parsed.pricing !== null) {
    if (typeof parsed.pricing !== "object") {
      errors.push('"pricing" must be null or an object');
    } else {
      if (parsed.pricing.model !== undefined && !VALID_PRICING_MODELS.includes(String(parsed.pricing.model))) {
        errors.push(`Invalid pricing.model: "${parsed.pricing.model}"`);
      }
    }
  }

  // forked_from (v1.2)
  if (parsed.forked_from !== undefined) {
    if (typeof parsed.forked_from !== "object" || parsed.forked_from === null) {
      errors.push('"forked_from" must be an object with "name" and "version"');
    } else {
      if (!parsed.forked_from.name || typeof parsed.forked_from.name !== "string") errors.push("forked_from.name is required");
      if (!parsed.forked_from.version || typeof parsed.forked_from.version !== "string") errors.push("forked_from.version is required");
    }
  }

  // encryption (v1.2) — structure validation for any pack declaring encryption
  if (parsed.encryption !== undefined) {
    if (typeof parsed.encryption !== "object" || parsed.encryption === null) {
      errors.push('"encryption" must be an object with "method" and "key_delivery"');
    } else {
      if (!parsed.encryption.method || typeof parsed.encryption.method !== "string") {
        errors.push("encryption.method is required");
      } else if (parsed.encryption.method !== "aes-256-gcm") {
        errors.push(`Unsupported encryption.method: "${parsed.encryption.method}" (only "aes-256-gcm" supported)`);
      }
      if (!parsed.encryption.key_delivery || typeof parsed.encryption.key_delivery !== "string") {
        errors.push("encryption.key_delivery is required");
      } else if (!VALID_KEY_DELIVERY.includes(parsed.encryption.key_delivery)) {
        errors.push(`Invalid encryption.key_delivery: "${parsed.encryption.key_delivery}" (expected: ${VALID_KEY_DELIVERY.join(", ")})`);
      }
    }
  }

  // access (v1.3)
  if (parsed.access !== undefined && !VALID_ACCESS.includes(String(parsed.access))) {
    errors.push(`Invalid access: "${parsed.access}" (expected: ${VALID_ACCESS.join(", ")})`);
  }

  // organization (v1.3) — required when access is private
  if (String(parsed.access) === "private") {
    if (!parsed.organization || typeof parsed.organization !== "string") {
      errors.push('Private packs require an "organization" field');
    } else if (!/^[a-z0-9][a-z0-9-]*$/.test(parsed.organization)) {
      errors.push(`Invalid organization slug: "${parsed.organization}" (must be lowercase alphanumeric with hyphens)`);
    }
  }
  if (parsed.organization !== undefined && String(parsed.access || "public") !== "private") {
    errors.push('"organization" field is only valid when access is "private"');
  }

  // ── Sealed pack rules ────────────────────────────────────────────
  if (String(parsed.visibility) === "sealed") {
    // readme required
    if (!parsed.readme) {
      errors.push('Sealed packs require a "readme" field');
    }

    // encryption block required
    if (!parsed.encryption) {
      errors.push('Sealed packs require an "encryption" block');
    }

    // pricing required for public sealed packs, must not be free
    // private sealed packs may omit pricing (internal org packs)
    if (String(parsed.access || "public") === "public") {
      if (!parsed.pricing) {
        errors.push('Public sealed packs require a "pricing" block');
      } else if (parsed.pricing.model === "free") {
        errors.push('Sealed packs cannot use pricing.model "free"');
      }
    }

    // tier must be certified or verified
    if (!parsed.tier || !SEALED_ALLOWED_TIERS.includes(String(parsed.tier))) {
      errors.push(`Sealed packs require tier "certified" or "verified" (got "${parsed.tier || "none"}")`);
    }

    // every skill prompt must be >= 20 chars (prevents accidentally empty sealed prompts)
    if (Array.isArray(parsed.skills)) {
      for (let i = 0; i < parsed.skills.length; i++) {
        const skill = parsed.skills[i];
        if (skill?.prompt && typeof skill.prompt === "string" && skill.prompt.length < 20) {
          errors.push(`skills[${i}] ("${skill.name}") prompt too short for sealed pack (${skill.prompt.length} chars, min 20)`);
        }
      }
    }
  }

  return errors;
}

async function main() {
  const files = (await readdir(PACKS_DIR)).filter(f => f.endsWith(".yaml") || f.endsWith(".yml")).sort();

  if (files.length === 0) {
    console.log("No pack manifests found.");
    return;
  }

  let totalErrors = 0;

  for (const file of files) {
    const content = await readFile(join(PACKS_DIR, file), "utf-8");
    let parsed;
    try {
      parsed = parseYaml(content);
    } catch (err) {
      console.log(`  FAIL  ${file}: YAML parse error: ${err.message}`);
      totalErrors++;
      continue;
    }

    const errors = validatePack(parsed);
    if (errors.length === 0) {
      console.log(`  PASS  ${file}`);
    } else {
      console.log(`  FAIL  ${file}`);
      for (const e of errors) console.log(`        - ${e}`);
      totalErrors += errors.length;
    }
  }

  console.log(`\n${files.length} packs validated, ${totalErrors} error(s).`);
  if (totalErrors > 0) process.exit(1);
}

export { validatePack };

// Run main() only when executed directly (not imported as a module)
const isMain =
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main().catch(err => { console.error(err); process.exit(1); });
}
