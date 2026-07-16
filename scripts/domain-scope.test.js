/**
 * DD-333 F.4 — granularity.domain_scope schema + S-DOM-002 procedural gate tests.
 *
 * Six test cases per spec § "Test cases stallari-plugins":
 *   1. acceptsHonestSingleDeclaration         — AJV pass, no finding.
 *   2. acceptsHonestMultiDeclaration          — AJV pass.
 *   3. rejectsUnknownEnumValue                — AJV reject.
 *   4. derivesNonConformingForUnspecified     — build-catalog derives "non-conforming-explicit".
 *   5. warnsOnSingleWithScopeArg              — procedural emits warning finding.
 *   6. passesWithDisclaimerAnnotation         — same as #5 but description carries
 *                                               `// scope-arg-disclaimer:`; finding downgrades to info.
 *
 * Existing 11 packs + 59 plugin entries in plugins/tools/ have no domain_scope
 * declared today; build-catalog.js must remain clean (zero new findings). The
 * "real-corpus smoke" suite below asserts this.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  validateCatalogEntry,
  enforceDomainScope,
  pluginToCatalogEntry,
  findDomainScopeArg,
  DOMAIN_SCOPE_ARG_PATTERN,
} from "./build-catalog.js";

const ROOT = resolve(import.meta.dirname, "..");
const FIXTURE_DIR = join(ROOT, "schemas", "fixtures", "catalog-entries");
const BUILD_SCRIPT = join(ROOT, "scripts", "build-catalog.js");
const TARGET_FILES = [
  "gmail-blade-mcp.json",
  "home-assistant-blade-mcp.json",
  "mastodon-blade-mcp.json",
  "tailscale-blade-mcp.json",
  "syncthing-blade-mcp.json",
];
const HOME_SINGLE = new Set([
  "ha_call_service", "ha_light", "ha_climate", "ha_scene", "ha_lock", "ha_alarm",
  "ha_automation_trigger", "ha_automation_toggle", "ha_automation_create",
  "ha_automation_delete", "ha_script_run", "ha_webhook", "ha_notify",
]);

function loadToolEntry(file) {
  return JSON.parse(readFileSync(join(ROOT, "plugins", "tools", file), "utf-8"));
}

function effectiveTools(entry) {
  const verdict = validateCatalogEntry(entry);
  return Promise.resolve(verdict).then((result) => {
    assert.equal(result.valid, true, result.errorsText);
    enforceDomainScope(entry, entry.name);
    return entry.tools;
  });
}

function loadFixture(name) {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf-8"));
}

describe("DD-333 F.4 — granularity.domain_scope AJV gate", () => {
  it("acceptsHonestSingleDeclaration — single tool bound to one domain, no scope arg", async () => {
    const entry = loadFixture("tool-domain-scope-single-honest.json");
    const verdict = await validateCatalogEntry(entry);
    assert.equal(verdict.valid, true, verdict.errorsText);
    const findings = enforceDomainScope(entry, "single-honest");
    assert.equal(findings.length, 0, `Expected no findings; got: ${JSON.stringify(findings)}`);
  });

  it("acceptsHonestMultiDeclaration — multi-domain tool with scope arg", async () => {
    const entry = loadFixture("tool-domain-scope-multi-honest.json");
    const verdict = await validateCatalogEntry(entry);
    assert.equal(verdict.valid, true, verdict.errorsText);
    // multi + scope arg is the contractually-consistent shape — no finding emitted.
    const findings = enforceDomainScope(entry, "multi-honest");
    assert.equal(findings.length, 0, `Expected no findings; got: ${JSON.stringify(findings)}`);
  });

  it("rejectsUnknownEnumValue — domain_scope: \"magic\" fails AJV", async () => {
    const entry = loadFixture("tool-domain-scope-bogus-enum.json");
    const verdict = await validateCatalogEntry(entry);
    assert.equal(verdict.valid, false);
    const hasEnumError = verdict.errors.some(
      (e) =>
        e.keyword === "enum" &&
        e.instancePath.includes("/tools/0/granularity/domain_scope"),
    );
    assert.ok(
      hasEnumError,
      `Expected enum error on /tools/0/granularity/domain_scope; got: ${verdict.errorsText}`,
    );
  });
});

describe("DD-333 F.4 — procedural cross-field gate (enforceDomainScope)", () => {
  it("derivesNonConformingForUnspecified — tool in domain_scope_unspecified gets non-conforming-explicit", async () => {
    const entry = loadFixture("tool-domain-scope-unspecified-derives.json");
    // AJV passes (the fixture's existing granularity block omits domain_scope only).
    const verdict = await validateCatalogEntry(entry);
    assert.equal(verdict.valid, true, verdict.errorsText);
    // Pre-derivation: tool has no domain_scope.
    assert.equal(entry.tools[0].granularity.domain_scope, undefined);
    // Post-derivation: mutated in place.
    const findings = enforceDomainScope(entry, "unspecified-derives");
    assert.equal(
      entry.tools[0].granularity.domain_scope,
      "non-conforming-explicit",
      "expected derivation to mutate granularity.domain_scope",
    );
    // No S-DOM-002 finding (domain_scope is not "single" post-derivation).
    assert.equal(findings.length, 0);
  });

  it("warnsOnSingleWithScopeArg — domain_scope=single + scope arg emits warning", () => {
    const entry = loadFixture("tool-domain-scope-single-with-scope-arg-violation.json");
    const findings = enforceDomainScope(entry, "single-violation");
    assert.equal(findings.length, 1, `Expected exactly 1 finding; got: ${JSON.stringify(findings)}`);
    const f = findings[0];
    assert.equal(f.id, "S-DOM-002");
    assert.equal(f.level, "warning");
    assert.match(f.message, /domain_scope="single"/);
    assert.match(f.message, /"scope"/);
  });

  it("passesWithDisclaimerAnnotation — same shape with disclaimer downgrades to info", () => {
    const entry = loadFixture("tool-domain-scope-disclaimer.json");
    const findings = enforceDomainScope(entry, "disclaimer");
    assert.equal(findings.length, 1, `Expected exactly 1 finding; got: ${JSON.stringify(findings)}`);
    const f = findings[0];
    assert.equal(f.id, "S-DOM-002");
    assert.equal(f.level, "info", "disclaimer annotation should downgrade warning → info");
  });

  it("throws on domain_scope_unspecified cross-reference mismatch (Constraint A)", () => {
    const entry = {
      name: "ds-mismatch-blade",
      version: "1.0.0",
      author: "stallari",
      type: "plugin",
      tools: [{ name: "list_records" }],
      non_conformance_rationale: {
        reason: "test",
        scope_filtering_off: true,
        contamination_risks: ["audit-context-leak"],
        affected_tools: ["list_records"],
        domain_scope_unspecified: ["nonexistent_tool"],
      },
    };
    assert.throws(
      () => enforceDomainScope(entry, "mismatch"),
      /domain_scope_unspecified references tool names not present in tools\[\]/,
    );
  });

  it("findDomainScopeArg recognises the canonical names", () => {
    const names = ["scope", "Scope", "domain", "domains", "domainName", "domain_name"];
    for (const n of names) {
      assert.ok(DOMAIN_SCOPE_ARG_PATTERN.test(n), `expected match: ${n}`);
      const arg = findDomainScopeArg({ arguments: [{ name: n, type: "string" }] });
      assert.equal(arg, n);
    }
  });

  it("findDomainScopeArg ignores non-domain-shaped names", () => {
    const arg = findDomainScopeArg({
      arguments: [
        { name: "query", type: "string" },
        { name: "limit", type: "integer" },
      ],
    });
    assert.equal(arg, null);
  });

  it("findDomainScopeArg requires string-ish type", () => {
    // Integer-typed `scope` is not a domain selector.
    const arg = findDomainScopeArg({ arguments: [{ name: "scope", type: "integer" }] });
    assert.equal(arg, null);
    // Enum without type still counts (treated as string-shaped).
    const arg2 = findDomainScopeArg({
      arguments: [{ name: "scope", enum: ["a", "b"] }],
    });
    assert.equal(arg2, "scope");
  });
});

describe("DD-333 F.4 — exact domain-scope corpus and generated projection", () => {
  it("derives the exact 13 single / 145 non-conforming distribution across the five source entries", async () => {
    const entries = TARGET_FILES.map(loadToolEntry);
    const protectedFields = new Map(entries.flatMap((entry) => entry.tools.map((tool) => [
      `${entry.name}/${tool.name}`,
      {
        risk_class: tool.risk_class,
        scope_filtering: tool.granularity.scope_filtering,
        field_projection: tool.granularity.field_projection,
        deterministic_ordering: tool.granularity.deterministic_ordering,
        audit_surface: tool.granularity.audit_surface,
      },
    ])));
    assert.equal(
      entries.flatMap((entry) => entry.tools)
        .filter((tool) => tool.granularity.domain_scope === "non-conforming-explicit").length,
      0,
      "domain-only rationale, not authors, must derive non-conforming-explicit",
    );
    const tools = (await Promise.all(entries.map(effectiveTools))).flat();
    assert.equal(tools.length, 158);

    const counts = tools.reduce((result, tool) => {
      result[tool.granularity.domain_scope] = (result[tool.granularity.domain_scope] || 0) + 1;
      return result;
    }, {});
    assert.deepEqual(counts, { single: 13, "non-conforming-explicit": 145 });

    const gmail = entries[0];
    assert.deepEqual(
      new Set(gmail.tools.map((tool) => tool.name)),
      new Set(gmail.non_conformance_rationale.domain_scope_unspecified),
    );
    assert.ok(gmail.tools.every((tool) => tool.granularity.domain_scope === "non-conforming-explicit"));

    const home = entries[1];
    const homeSingles = new Set(home.tools
      .filter((tool) => tool.granularity.domain_scope === "single")
      .map((tool) => tool.name));
    assert.deepEqual(homeSingles, HOME_SINGLE);
    const homeUnspecified = new Set(home.non_conformance_rationale.domain_scope_unspecified);
    assert.deepEqual(
      homeUnspecified,
      new Set(home.tools.map((tool) => tool.name).filter((name) => !HOME_SINGLE.has(name))),
    );

    for (const entry of entries) {
      const rationale = entry.non_conformance_rationale;
      assert.equal(rationale.scope_filtering_off, undefined);
      assert.equal(rationale.contamination_risks, undefined);
      assert.equal(rationale.affected_tools, undefined);
      const unspecified = rationale.domain_scope_unspecified;
      assert.equal(new Set(unspecified).size, unspecified.length);
      const named = new Set(entry.tools.map((tool) => tool.name));
      assert.ok(unspecified.every((name) => named.has(name)));
      assert.ok(entry.tools.every((tool) =>
        tool.granularity.domain_scope === "single" ||
        tool.granularity.domain_scope === "non-conforming-explicit"));
      for (const tool of entry.tools) {
        assert.deepEqual(
          {
            risk_class: tool.risk_class,
            scope_filtering: tool.granularity.scope_filtering,
            field_projection: tool.granularity.field_projection,
            deterministic_ordering: tool.granularity.deterministic_ordering,
            audit_surface: tool.granularity.audit_surface,
          },
          protectedFields.get(`${entry.name}/${tool.name}`),
        );
      }
    }
    for (const entry of entries.slice(2)) {
      assert.ok(entry.tools.every((tool) => tool.granularity.domain_scope === "non-conforming-explicit"));
    }
  });

  it("projects post-derivation tools into a catalog entry", async () => {
    const entry = loadToolEntry("gmail-blade-mcp.json");
    await effectiveTools(entry);
    const projected = pluginToCatalogEntry(entry);
    assert.equal(projected.tools, entry.tools);
    assert.ok(projected.tools.every((tool) => tool.granularity.domain_scope === "non-conforming-explicit"));
  });

  it("builds effective tools without S-DOM-002 warnings and preserves source tool counts", () => {
    const result = spawnSync(process.execPath, [BUILD_SCRIPT], {
      cwd: ROOT,
      encoding: "utf-8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    if (result.status !== 0) {
      assert.fail(
        `build-catalog.js failed on real corpus:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
      );
    }
    // The build emits "DD-333 F.4 S-DOM-002 —" header only when findings
    // exist. Its absence means clean.
    assert.doesNotMatch(
      result.stdout,
      /S-DOM-002 — \d+ warning/,
      `Expected zero S-DOM-002 warnings; got stdout:\n${result.stdout}`,
    );
    const generated = JSON.parse(readFileSync(join(ROOT, "dist", "catalog.json"), "utf-8")).data;
    const sourceEntries = readdirSync(join(ROOT, "plugins", "tools"))
      .filter((file) => file.endsWith(".json"))
      .map(loadToolEntry);
    for (const source of sourceEntries) {
      if (!Array.isArray(source.tools)) continue;
      const generatedEntry = generated.find((entry) => entry.name === source.name);
      assert.ok(generatedEntry, `missing generated entry for ${source.name}`);
      assert.equal(generatedEntry.tools.length, source.tools.length, source.name);
    }
    const selected = generated.filter((entry) => TARGET_FILES
      .map((file) => file.replace(/\.json$/, ""))
      .includes(entry.name));
    const generatedTools = selected.flatMap((entry) => entry.tools);
    assert.equal(generatedTools.length, 158);
    const generatedCounts = generatedTools.reduce((result, tool) => {
      result[tool.granularity.domain_scope] = (result[tool.granularity.domain_scope] || 0) + 1;
      return result;
    }, {});
    assert.deepEqual(generatedCounts, { single: 13, "non-conforming-explicit": 145 });
  });
});
