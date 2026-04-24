#!/usr/bin/env node
/**
 * Build catalog — transforms plugins/*.json and packs/*.yaml into the
 * CatalogResponse format expected by the Stallari app's RegistryClient.
 *
 * Reads:  plugins/tools/*.json, plugins/packs/*.yaml
 * Writes: dist/catalog.json, dist/services.json, dist/packs/<slug>/<version>/manifest.json
 *
 * Usage: node scripts/build-catalog.js
 */

import { readdir, readFile, mkdir, writeFile, copyFile, stat } from "node:fs/promises";
import { join, resolve, basename, extname } from "node:path";
import { parse as parseYaml } from "yaml";
const ROOT = resolve(import.meta.dirname, "..");
const TOOLS_DIR = join(ROOT, "plugins", "tools");
const PACKS_DIR = join(ROOT, "plugins", "packs");
const PRIVATE_PACKS_DIR = process.env.PRIVATE_PACKS_DIR || null;
const DATA_DIR = join(ROOT, "data");
const DIST_DIR = join(ROOT, "dist");

/** Convert a pack name to a URL-safe kebab-case slug: "Business Operations" → "business-operations" */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Derive service name from contract ID: "email-v1" → "email" */
function contractToService(contract) {
  return contract.replace(/-v\d+$/, "");
}

/** Extract unique service names from a pack manifest's requires/recommends/data blocks */
function extractPackServices(pack) {
  const services = new Set();

  for (const block of [pack.requires, pack.recommends]) {
    if (block?.services) {
      for (const svc of block.services) {
        if (svc.service) services.add(svc.service);
      }
    }
  }

  if (pack.data) {
    for (const list of [pack.data.reads, pack.data.writes]) {
      if (Array.isArray(list)) {
        for (const svc of list) services.add(svc);
      }
    }
  }

  return [...services].sort();
}

/** Map legacy tier to two-axis author_type + readiness (deterministic fallback) */
function resolveCertification(source) {
  if (source.author_type && source.readiness) {
    return { author_type: source.author_type, readiness: source.readiness };
  }
  switch (source.tier) {
    case "certified":
      return { author_type: "first-party", readiness: "production" };
    case "verified":
      return { author_type: "community", readiness: "production" };
    case "community":
      return { author_type: "community", readiness: "beta" };
    default:
      return { author_type: "community", readiness: "experimental" };
  }
}

/** Convert a raw plugin JSON to a CatalogEntry */
function pluginToCatalogEntry(raw) {
  const contracts = raw.contract
    ? (Array.isArray(raw.contract) ? raw.contract : [raw.contract])
    : [];
  const services = contracts.map(contractToService);

  // DD106: setup metadata summary
  const setup = raw.setup;
  const envCount = Array.isArray(raw.env) ? raw.env.length : 0;
  const fieldCount = setup?.fields?.length || envCount;

  const { author_type, readiness } = resolveCertification(raw);

  return {
    name: raw.name,
    title: raw.title || null,
    type: "plugin",
    version: raw.version,
    description: raw.description || null,
    author: { name: raw.author },
    services,
    min_stallari: null,
    installs: null,
    likes: null,
    compatibility: null,
    repository: raw.repository || null,
    created: null,
    updated: null,
    visibility: "open",
    tier: raw.tier,
    author_type,
    readiness,
    contract: raw.contract || null,
    runtime: raw.install?.runtime || raw.runtime || null,
    license: raw.license || null,
    conformance: raw.conformance || null,
    inference: raw.inference || null,
    certification: raw.certification || null,
    // Icon for marketplace cards
    icon: raw.icon || null,
    // DD106: setup summary for marketplace display
    setup_complexity: setup?.complexity || (fieldCount === 0 ? "none" : null),
    auth_model: setup?.auth_model || null,
    credential_count: fieldCount,
    setup_icon: setup?.icon || null,
    // Full setup block for install wizard credential forms
    setup: setup || null,
    // v1.2: rich detail fields
    tagline: raw.tagline || null,
    readme: raw.readme || null,
    highlights: Array.isArray(raw.highlights) && raw.highlights.length > 0 ? raw.highlights : null,
    links: Array.isArray(raw.links) && raw.links.length > 0 ? raw.links : null,
    hero: raw.hero || null,
    scenarios: Array.isArray(raw.scenarios) && raw.scenarios.length > 0 ? raw.scenarios : null,
  };
}

/** Convert a public pack manifest (YAML) to a CatalogEntry */
function packToCatalogEntry(pack) {
  const services = extractPackServices(pack);
  const skillCount = Array.isArray(pack.skills) ? pack.skills.length : 0;
  const agentCount = pack.agents ? Object.keys(pack.agents).length : 0;
  const workflowCount = Array.isArray(pack.workflows)
    ? pack.workflows.length
    : 0;

  // v1.2: aggregate skill categories and services_used
  const skillCategories = [
    ...new Set(
      (pack.skills || []).map((s) => s.category).filter(Boolean),
    ),
  ].sort();

  const servicesUsed = new Set();
  for (const skill of pack.skills || []) {
    for (const su of skill.services_used || []) {
      if (su.service) servicesUsed.add(su.service);
    }
  }

  // v1.4: count webhook-triggered skills
  const webhookCount = (pack.skills || []).filter(
    (s) => s.trigger?.webhook || s.webhook_name,
  ).length;

  const packTier = pack.tier || "community";
  const { author_type, readiness } = resolveCertification({ ...pack, tier: packTier });

  return {
    name: pack.name,
    title: pack.title || null,
    featured: !!pack.featured,
    slug: slugify(pack.name),
    type: "pack",
    version: pack.version,
    description: pack.description || null,
    author: pack.author || null,
    services,
    min_stallari: pack.min_stallari || null,
    installs: null,
    likes: null,
    compatibility: null,
    repository: null,
    created: null,
    updated: null,
    visibility: pack.visibility || "open",
    tier: packTier,
    author_type,
    readiness,
    license: pack.license || null,
    pack_spec: pack.pack || null,
    // Pack-specific metadata
    skill_count: skillCount,
    agent_count: agentCount,
    workflow_count: workflowCount,
    // Pricing (v1.1)
    pricing: pack.pricing || null,
    // Bundled plugins (sealed+certified only)
    bundled_plugins: pack.plugins
      ? pack.plugins.map((p) => p.name)
      : null,
    bundled_contracts: pack.contracts
      ? pack.contracts.map((c) => c.name)
      : null,
    // Icon for marketplace cards
    icon: pack.icon || null,
    // v1.2 metadata
    skill_categories: skillCategories.length > 0 ? skillCategories : null,
    services_used_summary: servicesUsed.size > 0 ? [...servicesUsed].sort() : null,
    forked_from: pack.forked_from || null,
    has_encryption: !!pack.encryption,
    has_readme: !!pack.readme,
    bundled: !!pack.bundled,
    // v1.2: rich detail fields
    tagline: pack.tagline || null,
    readme: pack.readme || null,
    highlights: Array.isArray(pack.highlights) && pack.highlights.length > 0 ? pack.highlights : null,
    links: Array.isArray(pack.links) && pack.links.length > 0 ? pack.links : null,
    hero: pack.hero || null,
    // v1.4: webhook metadata (DD113)
    webhook_count: webhookCount > 0 ? webhookCount : null,
    // Suggested plugins for install wizard
    suggested_plugins: Array.isArray(pack.suggested_plugins) && pack.suggested_plugins.length > 0
      ? pack.suggested_plugins
      : null,
    // v1.3: org access control (DD104)
    access: pack.access || "public",
    organization: pack.organization || null,
  };
}

/** Generate static scenario cards for each catalog entry by cross-referencing services */
function buildScenarios(entries) {
  // Index: service → entries that provide/use it
  const byService = new Map();
  for (const entry of entries) {
    for (const svc of entry.services || []) {
      if (!byService.has(svc)) byService.set(svc, []);
      byService.get(svc).push(entry);
    }
  }

  // For packs, also index by services_used_summary
  for (const entry of entries) {
    if (entry.type === "pack") {
      for (const svc of entry.services_used_summary || []) {
        if (!byService.has(svc)) byService.set(svc, []);
        const list = byService.get(svc);
        if (!list.some((e) => e.name === entry.name)) {
          list.push(entry);
        }
      }
    }
  }

  for (const entry of entries) {
    const scenarios = [];
    const seen = new Set([entry.name]);
    const entryServices = new Set([
      ...(entry.services || []),
      ...(entry.services_used_summary || []),
    ]);

    // Find companions: entries that share at least one service
    const companions = [];
    for (const svc of entryServices) {
      for (const other of byService.get(svc) || []) {
        if (seen.has(other.name)) continue;
        seen.add(other.name);
        const otherServices = new Set([
          ...(other.services || []),
          ...(other.services_used_summary || []),
        ]);
        const shared = [...entryServices].filter((s) => otherServices.has(s));
        companions.push({ entry: other, shared });
      }
    }

    // Sort by overlap count descending, then by tier (certified > verified > community)
    const tierRank = { certified: 0, verified: 1, community: 2 };
    companions.sort(
      (a, b) =>
        b.shared.length - a.shared.length ||
        (tierRank[a.entry.tier] ?? 3) - (tierRank[b.entry.tier] ?? 3),
    );

    // Top 3 companions become "pairs with" scenarios
    for (const c of companions.slice(0, 3)) {
      const sharedLabel = c.shared.join(", ");
      const verb = c.entry.type === "pack" ? "Combine with" : "Pair with";
      scenarios.push({
        type: "pairs_with",
        target: c.entry.name,
        target_type: c.entry.type,
        shared_services: c.shared,
        label: `${verb} ${c.entry.name}`,
        body: `Both use ${sharedLabel}. ${c.entry.description?.split(".")[0] || c.entry.name}.`,
      });
    }

    // Generate use-case sentence based on entry type and services
    if (entry.type === "plugin" && entry.services.length > 0) {
      const svc = entry.services[0];
      scenarios.push({
        type: "use_case",
        label: `Build a ${svc} workflow`,
        body: `Use the Forge to design an automation pack powered by ${entry.name} for ${svc} operations.`,
      });
    } else if (entry.type === "pack") {
      const cats = entry.skill_categories || [];
      if (cats.length > 0) {
        scenarios.push({
          type: "use_case",
          label: `Extend with your own skills`,
          body: `This pack covers ${cats.join(", ")}. Fork it in the Forge to add skills for your specific workflow.`,
        });
      }
    }

    // Authored scenarios first, then auto-generated
    const authored = Array.isArray(entry.scenarios) ? entry.scenarios : [];
    const merged = [...authored, ...scenarios];
    entry.scenarios = merged.length > 0 ? merged : null;
  }
}

/** Build ServiceInfo summaries from catalog entries */
function buildServices(entries) {
  const serviceMap = new Map();

  for (const entry of entries) {
    for (const svc of entry.services || []) {
      if (!serviceMap.has(svc)) {
        serviceMap.set(svc, { service: svc, plugin_count: 0, pack_count: 0 });
      }
      const info = serviceMap.get(svc);
      if (entry.type === "plugin") info.plugin_count++;
      else if (entry.type === "pack") info.pack_count++;
    }
  }

  return Array.from(serviceMap.values()).sort((a, b) =>
    a.service.localeCompare(b.service),
  );
}

/** Read YAML files from a single directory, returning parsed packs */
async function loadPacksFromDir(dir) {
  let files;
  try {
    files = (await readdir(dir)).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
    );
  } catch {
    return [];
  }

  files.sort();
  const packs = [];

  for (const file of files) {
    const content = await readFile(join(dir, file), "utf-8");
    const pack = parseYaml(content);

    if (!pack.pack || !pack.name || !pack.version || !pack.skills) {
      console.warn(
        `  ⚠ Skipping ${file}: missing required fields (pack, name, version, skills)`,
      );
      continue;
    }

    packs.push({ manifest: pack, filename: file, sealed: false });
  }

  return packs;
}

/**
 * Read pre-sealed pack artifacts from a directory structured as:
 *   {dir}/{slug}/{version}/manifest.json
 *
 * Sealing happens client-side — the registry receives pre-sealed artifacts.
 * This function reads the sealed manifests for catalog entry generation.
 */
async function loadSealedPacksFromDir(dir) {
  let slugs;
  try {
    slugs = await readdir(dir);
  } catch {
    return [];
  }

  const packs = [];

  for (const slug of slugs.sort()) {
    const slugDir = join(dir, slug);
    const slugStat = await stat(slugDir).catch(() => null);
    if (!slugStat?.isDirectory()) continue;

    const versions = await readdir(slugDir);
    for (const version of versions.sort()) {
      const packDir = join(slugDir, version);
      const versionStat = await stat(packDir).catch(() => null);
      if (!versionStat?.isDirectory()) continue;

      const manifestPath = join(packDir, "manifest.json");
      let manifest;
      try {
        manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
      } catch {
        continue;
      }

      if (!manifest.name || !manifest.version) {
        console.warn(`  ⚠ Skipping ${slug}/${version}: missing name or version`);
        continue;
      }

      packs.push({ manifest, filename: null, sealed: true, sourceDir: packDir });
    }
  }

  return packs;
}

/** Read and validate packs from primary dir + optional PRIVATE_PACKS_DIR */
async function loadPacks() {
  const packs = await loadPacksFromDir(PACKS_DIR);
  if (PRIVATE_PACKS_DIR) {
    const sealedPacks = await loadSealedPacksFromDir(PRIVATE_PACKS_DIR);
    if (sealedPacks.length > 0) {
      console.log(`  Loaded ${sealedPacks.length} pre-sealed pack(s) from PRIVATE_PACKS_DIR`);
    }
    packs.push(...sealedPacks);
  }
  return packs;
}

async function main() {
  // Read all plugin JSON files
  const pluginFiles = (await readdir(TOOLS_DIR)).filter((f) =>
    f.endsWith(".json"),
  );
  pluginFiles.sort();

  const entries = [];

  // Plugins
  for (const file of pluginFiles) {
    const raw = JSON.parse(await readFile(join(TOOLS_DIR, file), "utf-8"));
    if (raw.hidden) continue;
    entries.push(pluginToCatalogEntry(raw));
  }

  // Packs
  const packs = await loadPacks();
  for (const { manifest } of packs) {
    entries.push(packToCatalogEntry(manifest));
  }

  const now = new Date().toISOString().split("T")[0];

  const catalog = {
    meta: {
      version: "1.1.0",
      generated: now,
      total: entries.length,
      plugins: entries.filter((e) => e.type === "plugin").length,
      packs: entries.filter((e) => e.type === "pack").length,
    },
    data: entries,
  };

  const services = buildServices(entries);

  // Cross-reference entries to generate static scenario cards
  buildScenarios(entries);

  // Write catalog and services
  await mkdir(DIST_DIR, { recursive: true });
  await writeFile(
    join(DIST_DIR, "catalog.json"),
    JSON.stringify(catalog, null, 2) + "\n",
  );
  await writeFile(
    join(DIST_DIR, "services.json"),
    JSON.stringify(services, null, 2) + "\n",
  );

  // Copy static data files (models.json)
  await copyFile(join(DATA_DIR, "models.json"), join(DIST_DIR, "models.json"));

  // Build pack-details.json — skill/agent/workflow summaries for web marketplace
  const packDetails = {};
  for (const { manifest } of packs) {
    const agents = manifest.agents
      ? Object.entries(manifest.agents).map(([name, a]) => ({
          name,
          role: a.role,
        }))
      : [];
    const skills = (manifest.skills || []).map((s) => ({
      name: s.name,
      description: s.description,
      agent: s.agent || null,
      category: s.category || null,
      trigger: s.trigger
        ? s.trigger.schedule
          ? "schedule"
          : s.trigger.webhook
            ? "webhook"
            : s.trigger.on_demand
              ? "on_demand"
              : "on_demand"
        : "on_demand",
    }));
    const workflows = (manifest.workflows || []).map((w) => ({
      name: w.name,
      description: w.description || null,
      steps: w.steps ? w.steps.length : 0,
      schedule: w.schedule || null,
    }));
    packDetails[manifest.name] = { agents, skills, workflows };
  }
  await writeFile(
    join(DIST_DIR, "pack-details.json"),
    JSON.stringify(packDetails, null, 2) + "\n",
  );

  // Write individual pack manifests (for /packs/:name/versions/:version endpoint)
  // Open packs: write manifest from YAML data.
  // Sealed packs: copy pre-sealed artifacts (manifest.json + payload.enc + seal-key.hex).
  // Sealing is a client-side operation — CI never encrypts.
  for (const { manifest, sealed, sourceDir } of packs) {
    const slug = slugify(manifest.name);
    const packDir = join(DIST_DIR, "packs", slug, manifest.version);
    await mkdir(packDir, { recursive: true });

    if (sealed && sourceDir) {
      // Copy pre-sealed artifacts as-is
      await copyFile(join(sourceDir, "manifest.json"), join(packDir, "manifest.json"));
      const sealFiles = ["payload.enc", "seal-key.hex", "inspection.json"];
      for (const f of sealFiles) {
        try {
          await copyFile(join(sourceDir, f), join(packDir, f));
        } catch {
          // inspection.json is optional
          if (f !== "inspection.json") throw new Error(`Missing sealed artifact: ${sourceDir}/${f}`);
        }
      }
    } else {
      await writeFile(
        join(packDir, "manifest.json"),
        JSON.stringify(manifest, null, 2) + "\n",
      );
    }
  }

  const pluginCount = entries.filter((e) => e.type === "plugin").length;
  const packCount = entries.filter((e) => e.type === "pack").length;
  console.log(
    `Built catalog: ${pluginCount} plugins + ${packCount} packs = ${entries.length} entries, ${services.length} services`,
  );
  console.log("Output: dist/catalog.json, dist/services.json");
  if (packCount > 0) {
    console.log(`Output: dist/packs/ (${packCount} pack manifests)`);
  }
}

export {
  slugify,
  contractToService,
  extractPackServices,
  resolveCertification,
  pluginToCatalogEntry,
  packToCatalogEntry,
  buildServices,
  buildScenarios,
};

// Run main() only when executed directly (not imported as a module)
const isMain =
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
