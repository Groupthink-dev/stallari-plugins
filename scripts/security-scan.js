#!/usr/bin/env node
/**
 * DD-147 P5 — Security scan all pack YAML files.
 *
 * Runs SINJ prompt injection rules and cross-pack clone detection
 * (trigram Jaccard similarity) against all packs in plugins/packs/.
 *
 * Usage: node scripts/security-scan.js
 * Exit codes: 0=pass, 1=fail (critical/high), 2=warn (medium/low).
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { scanPackYAML, buildCorpusFromPacks } from "stallari-secops-scanner";

const ROOT = resolve(import.meta.dirname, "..");
const PACKS_DIR = join(ROOT, "plugins", "packs");
const EXCEPTIONS_DIR = join(ROOT, "plugins", "scan-exceptions");

/**
 * Load per-pack scan exceptions from plugins/scan-exceptions/{name}.json.
 * Returns empty array if no exceptions file exists.
 */
async function loadExceptions(packName) {
  try {
    const raw = await readFile(join(EXCEPTIONS_DIR, `${packName}.json`), "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function main() {
  const files = (await readdir(PACKS_DIR))
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();

  if (files.length === 0) {
    console.log("  No pack files found.");
    return;
  }

  // Load all pack content
  const packs = [];
  for (const file of files) {
    const yaml = await readFile(join(PACKS_DIR, file), "utf-8");
    packs.push({ name: file.replace(/\.(yaml|yml)$/, ""), yaml });
  }

  // Build corpus from all packs for cross-pack clone detection
  const corpus = buildCorpusFromPacks(packs);

  // Scan each pack
  let overallResult = "pass";
  let totalFindings = 0;
  let totalCloneFindings = 0;

  for (const { name, yaml } of packs) {
    const exceptions = await loadExceptions(name);
    let result;
    try {
      result = scanPackYAML(yaml, { corpus, threats: [], exceptions });
    } catch (err) {
      console.log(`  FAIL  ${name}: parse error: ${err.message}`);
      overallResult = "fail";
      totalFindings++;
      continue;
    }

    const activeClones = result.clone_findings.filter((f) => !f.suppressed);
    const icon =
      result.result === "pass"
        ? "PASS"
        : result.result === "fail"
          ? "FAIL"
          : "WARN";
    console.log(
      `  ${icon}  ${name} — ${result.findings.length} SINJ, ${activeClones.length} clone`,
    );

    for (const f of result.findings) {
      console.log(
        `        ${f.severity.toUpperCase()} [${f.rule_id}] ${f.location}: ${f.message}`,
      );
    }
    for (const cf of activeClones) {
      console.log(
        `        ${cf.severity.toUpperCase()} [${cf.rule_id}] ${cf.location}: ${cf.message}`,
      );
    }

    totalFindings += result.findings.length;
    totalCloneFindings += activeClones.length;

    if (result.result === "fail") overallResult = "fail";
    else if (result.result === "warn" && overallResult === "pass")
      overallResult = "warn";
  }

  console.log(
    `\n  ${files.length} pack(s) scanned. ${totalFindings} SINJ + ${totalCloneFindings} clone finding(s).\n`,
  );

  if (overallResult === "fail") process.exit(1);
  if (overallResult === "warn") process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
