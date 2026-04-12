import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  slugify,
  contractToService,
  extractPackServices,
  pluginToCatalogEntry,
  packToCatalogEntry,
  buildServices,
} from "./build-catalog.js";

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe("slugify", () => {
  it("converts title-case with spaces to kebab-case", () => {
    assert.equal(slugify("Business Operations"), "business-operations");
  });

  it("leaves already-kebab names unchanged", () => {
    assert.equal(slugify("sidereal-sysadmin"), "sidereal-sysadmin");
  });

  it("handles multiple spaces and special characters", () => {
    assert.equal(slugify("My Cool Pack!"), "my-cool-pack");
  });

  it("strips leading and trailing hyphens", () => {
    assert.equal(slugify("  Test Pack  "), "test-pack");
  });
});

// ---------------------------------------------------------------------------
// contractToService
// ---------------------------------------------------------------------------

describe("contractToService", () => {
  it("strips -v1 suffix from email-v1", () => {
    assert.equal(contractToService("email-v1"), "email");
  });

  it("strips -v1 suffix from tasks-v1", () => {
    assert.equal(contractToService("tasks-v1"), "tasks");
  });

  it("strips -v1 suffix from vault-v1", () => {
    assert.equal(contractToService("vault-v1"), "vault");
  });

  it("leaves bare service name unchanged", () => {
    assert.equal(contractToService("email"), "email");
  });
});

// ---------------------------------------------------------------------------
// extractPackServices
// ---------------------------------------------------------------------------

describe("extractPackServices", () => {
  it("extracts unique sorted services from requires, recommends, and data blocks", () => {
    const pack = {
      requires: {
        services: [
          { service: "email", operations: ["read"] },
          { service: "vault", operations: ["search"] },
        ],
      },
      recommends: {
        services: [{ service: "tasks", operations: ["list"] }],
      },
      data: {
        reads: ["calendar", "vault"],
        writes: ["email"],
      },
    };

    assert.deepEqual(extractPackServices(pack), [
      "calendar",
      "email",
      "tasks",
      "vault",
    ]);
  });

  it("returns empty array for pack with no requires, recommends, or data", () => {
    assert.deepEqual(extractPackServices({}), []);
  });
});

// ---------------------------------------------------------------------------
// packToCatalogEntry
// ---------------------------------------------------------------------------

describe("packToCatalogEntry", () => {
  it("produces correct shape with defaults for a minimal pack", () => {
    const pack = {
      pack: "1.0",
      name: "test-pack",
      version: "0.1.0",
      description: "A test pack",
      skills: [
        { name: "skill-a", prompt: "do A" },
        { name: "skill-b", prompt: "do B" },
      ],
    };

    const entry = packToCatalogEntry(pack);

    assert.equal(entry.type, "pack");
    assert.equal(entry.name, "test-pack");
    assert.equal(entry.slug, "test-pack");
    assert.equal(entry.version, "0.1.0");
    assert.equal(entry.description, "A test pack");
    assert.equal(entry.pack_spec, "1.0");
    assert.equal(entry.skill_count, 2);
    assert.equal(entry.agent_count, 0);
    assert.equal(entry.workflow_count, 0);
    assert.equal(entry.tier, "community");
    assert.equal(entry.visibility, "open");
    assert.equal(entry.pricing, null);
    assert.deepEqual(entry.services, []);
    assert.equal(entry.bundled_plugins, null);
    assert.equal(entry.bundled_contracts, null);
  });

  it("slugifies title-case pack names", () => {
    const pack = {
      pack: "1.2",
      name: "Business Operations",
      version: "1.0.0",
      description: "Business ops",
      skills: [{ name: "s1", prompt: "go" }],
    };
    const entry = packToCatalogEntry(pack);
    assert.equal(entry.name, "Business Operations");
    assert.equal(entry.slug, "business-operations");
  });

  it("passes through tier, pricing, and visibility from a v1.1 pack", () => {
    const pack = {
      pack: "1.1",
      name: "premium-pack",
      version: "2.0.0",
      description: "Premium",
      tier: "certified",
      visibility: "sealed",
      pricing: { model: "subscription", amount: 9.99, interval: "monthly" },
      skills: [{ name: "s1", prompt: "go" }],
      agents: { coordinator: { model: "sonnet" } },
      workflows: [{ name: "w1", steps: [] }],
      requires: {
        services: [{ service: "email", operations: ["read"] }],
      },
    };

    const entry = packToCatalogEntry(pack);

    assert.equal(entry.tier, "certified");
    assert.equal(entry.visibility, "sealed");
    assert.deepEqual(entry.pricing, {
      model: "subscription",
      amount: 9.99,
      interval: "monthly",
    });
    assert.equal(entry.pack_spec, "1.1");
    assert.equal(entry.skill_count, 1);
    assert.equal(entry.agent_count, 1);
    assert.equal(entry.workflow_count, 1);
    assert.deepEqual(entry.services, ["email"]);
  });
});

// ---------------------------------------------------------------------------
// pluginToCatalogEntry
// ---------------------------------------------------------------------------

describe("pluginToCatalogEntry", () => {
  it("produces correct shape with type=plugin and derived services", () => {
    const raw = {
      name: "fastmail-blade-mcp",
      version: "0.1.0",
      description: "Fastmail JMAP MCP server",
      author: "Piers Beckley",
      contract: "email-v1",
      tier: "certified",
      install: { runtime: "node", package: "fastmail-blade-mcp" },
      repository: "https://github.com/example/fastmail-blade-mcp",
      licence: "MIT",
    };

    const entry = pluginToCatalogEntry(raw);

    assert.equal(entry.type, "plugin");
    assert.equal(entry.name, "fastmail-blade-mcp");
    assert.equal(entry.version, "0.1.0");
    assert.equal(entry.description, "Fastmail JMAP MCP server");
    assert.deepEqual(entry.author, { name: "Piers Beckley" });
    assert.equal(entry.contract, "email-v1");
    assert.deepEqual(entry.services, ["email"]);
    assert.equal(entry.tier, "certified");
    assert.equal(entry.runtime, "node");
    assert.equal(entry.repository, "https://github.com/example/fastmail-blade-mcp");
    assert.equal(entry.licence, "MIT");
    assert.equal(entry.visibility, "open");
    assert.equal(entry.min_sidereal, null);
    assert.equal(entry.installs, null);
    assert.equal(entry.conformance, null);
    assert.equal(entry.inference, null);
  });

  it("extracts setup summary from setup block (DD106)", () => {
    const raw = {
      name: "shopify-blade-mcp",
      version: "0.1.0",
      description: "Shopify MCP",
      author: "groupthink-dev",
      tier: "certified",
      install: { runtime: "uv", package: "shopify-blade-mcp" },
      licence: "MIT",
      contract: "ecommerce-v1",
      env: [
        { name: "SHOPIFY_STORE_URL", description: "Store URL" },
        { name: "SHOPIFY_ACCESS_TOKEN", description: "Token", secret: true },
      ],
      setup: {
        auth_model: "api_key",
        complexity: "moderate",
        fields: [
          { key: "SHOPIFY_STORE_URL", label: "Store URL" },
          { key: "SHOPIFY_ACCESS_TOKEN", label: "Access Token", secret: true },
        ],
      },
    };

    const entry = pluginToCatalogEntry(raw);

    assert.equal(entry.setup_complexity, "moderate");
    assert.equal(entry.auth_model, "api_key");
    assert.equal(entry.credential_count, 2);
  });

  it("falls back to env count when setup has no fields (DD106)", () => {
    const raw = {
      name: "test-plugin",
      version: "0.1.0",
      description: "Test",
      author: "test",
      tier: "community",
      install: { runtime: "uv", package: "test" },
      licence: "MIT",
      contract: null,
      env: [
        { name: "API_KEY", description: "Key", secret: true },
      ],
    };

    const entry = pluginToCatalogEntry(raw);

    assert.equal(entry.setup_complexity, null);
    assert.equal(entry.auth_model, null);
    assert.equal(entry.credential_count, 1);
  });

  it("returns none/0 when plugin has no env or setup (DD106)", () => {
    const raw = {
      name: "native-plugin",
      version: "1.0.0",
      description: "Native",
      author: "test",
      tier: "certified",
      install: { runtime: "native" },
      licence: "MIT",
      contract: "vault-v1",
    };

    const entry = pluginToCatalogEntry(raw);

    assert.equal(entry.setup_complexity, "none");
    assert.equal(entry.auth_model, null);
    assert.equal(entry.credential_count, 0);
  });

  it("extracts auth_model none from minimal setup block (DD106)", () => {
    const raw = {
      name: "things3-blade-mcp",
      version: "0.1.0",
      description: "Things 3",
      author: "test",
      tier: "certified",
      install: { runtime: "uv", package: "things3-blade-mcp" },
      licence: "MIT",
      contract: "tasks-v1",
      setup: { auth_model: "none" },
    };

    const entry = pluginToCatalogEntry(raw);

    assert.equal(entry.setup_complexity, "none");
    assert.equal(entry.auth_model, "none");
    assert.equal(entry.credential_count, 0);
  });
});

// ---------------------------------------------------------------------------
// buildServices
// ---------------------------------------------------------------------------

describe("buildServices", () => {
  it("aggregates plugin_count and pack_count from mixed entries", () => {
    const entries = [
      { type: "plugin", services: ["email"] },
      { type: "plugin", services: ["email", "vault"] },
      { type: "pack", services: ["email", "tasks"] },
      { type: "pack", services: ["vault", "calendar"] },
    ];

    const result = buildServices(entries);

    // Should be sorted alphabetically by service name
    assert.equal(result.length, 4);

    const calendar = result.find((s) => s.service === "calendar");
    assert.deepEqual(calendar, {
      service: "calendar",
      plugin_count: 0,
      pack_count: 1,
    });

    const email = result.find((s) => s.service === "email");
    assert.deepEqual(email, {
      service: "email",
      plugin_count: 2,
      pack_count: 1,
    });

    const tasks = result.find((s) => s.service === "tasks");
    assert.deepEqual(tasks, {
      service: "tasks",
      plugin_count: 0,
      pack_count: 1,
    });

    const vault = result.find((s) => s.service === "vault");
    assert.deepEqual(vault, {
      service: "vault",
      plugin_count: 1,
      pack_count: 1,
    });
  });

  it("returns empty array when given no entries", () => {
    assert.deepEqual(buildServices([]), []);
  });
});
