import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  slugify,
  contractToService,
  extractPackServices,
  computeCanonicalDigest,
  pluginToCatalogEntry,
  packToCatalogEntry,
  buildServices,
  validatePluginUX,
} from "./build-catalog.js";

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe("slugify", () => {
  it("converts title-case with spaces to kebab-case", () => {
    assert.equal(slugify("Business Operations"), "business-operations");
  });

  it("leaves already-kebab names unchanged", () => {
    assert.equal(slugify("stallari-sysadmin"), "stallari-sysadmin");
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
      license: "MIT",
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
    assert.equal(entry.license, "MIT");
    assert.equal(entry.visibility, "open");
    assert.equal(entry.min_stallari, null);
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
      license: "MIT",
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
      license: "MIT",
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
      license: "MIT",
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
      license: "MIT",
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

// ---------------------------------------------------------------------------
// computeCanonicalDigest (DD-163)
// ---------------------------------------------------------------------------

describe("computeCanonicalDigest", () => {
  it("produces a deterministic 64-char hex digest", () => {
    const pack = {
      skills: [
        { name: "greet", prompt: "Say hello" },
        { name: "farewell", prompt: "Say goodbye" },
      ],
    };
    const hash = computeCanonicalDigest(pack);
    assert.equal(hash.length, 64);
    assert.match(hash, /^[a-f0-9]{64}$/);

    // Same input → same output
    assert.equal(computeCanonicalDigest(pack), hash);
  });

  it("changes when a skill prompt changes", () => {
    const pack1 = {
      skills: [{ name: "greet", prompt: "Say hello" }],
    };
    const pack2 = {
      skills: [{ name: "greet", prompt: "Say hi" }],
    };
    assert.notEqual(
      computeCanonicalDigest(pack1),
      computeCanonicalDigest(pack2),
    );
  });

  it("is stable across skill reordering", () => {
    const pack1 = {
      skills: [
        { name: "alpha", prompt: "A" },
        { name: "beta", prompt: "B" },
      ],
    };
    const pack2 = {
      skills: [
        { name: "beta", prompt: "B" },
        { name: "alpha", prompt: "A" },
      ],
    };
    assert.equal(
      computeCanonicalDigest(pack1),
      computeCanonicalDigest(pack2),
    );
  });

  it("includes agents in the digest", () => {
    const withAgents = {
      skills: [{ name: "greet", prompt: "Hello" }],
      agents: { assistant: { prompt: "You are helpful" } },
    };
    const withoutAgents = {
      skills: [{ name: "greet", prompt: "Hello" }],
    };
    assert.notEqual(
      computeCanonicalDigest(withAgents),
      computeCanonicalDigest(withoutAgents),
    );
  });

  it("includes guardrail rules in the digest", () => {
    const withGuardrails = {
      skills: [{ name: "greet", prompt: "Hello" }],
      guardrails: {
        rules: [{ id: "vault-001", text: "Never delete notes" }],
      },
    };
    const withoutGuardrails = {
      skills: [{ name: "greet", prompt: "Hello" }],
    };
    assert.notEqual(
      computeCanonicalDigest(withGuardrails),
      computeCanonicalDigest(withoutGuardrails),
    );
  });

  it("is stable across agent key reordering", () => {
    const pack1 = {
      skills: [],
      agents: { zulu: { prompt: "Z" }, alpha: { prompt: "A" } },
    };
    const pack2 = {
      skills: [],
      agents: { alpha: { prompt: "A" }, zulu: { prompt: "Z" } },
    };
    assert.equal(
      computeCanonicalDigest(pack1),
      computeCanonicalDigest(pack2),
    );
  });

  it("packToCatalogEntry includes integrity field", () => {
    const pack = {
      name: "Test Pack",
      description: "A test pack",
      data: { reads: [], writes: [], stores: "nothing", phones_home: false },
      skills: [{ name: "test-skill", prompt: "Do a thing" }],
    };
    const entry = packToCatalogEntry(pack);
    assert.ok(entry.integrity);
    assert.ok(entry.integrity.sha256);
    assert.equal(entry.integrity.sha256.length, 64);
  });
});

// ---------------------------------------------------------------------------
// validatePluginUX
// ---------------------------------------------------------------------------

describe("validatePluginUX", () => {
  it("returns no warnings for a complete setup block", () => {
    const raw = {
      name: "test-mcp",
      setup: {
        blurb: "Test thing",
        help: [{ label: "Get key", url: "https://example.com" }],
        test: { endpoint: "https://api.example.com/health" },
        fields: [
          { key: "API_KEY", required: true, help: "Create at example.com" },
        ],
      },
    };
    assert.deepEqual(validatePluginUX(raw), []);
  });

  it("warns on missing setup block when env vars are declared", () => {
    const raw = { name: "test-mcp", env: [{ name: "FOO", required: true }] };
    const warnings = validatePluginUX(raw);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /missing setup block/);
  });

  it("returns no warnings for a manifest with no env and no setup", () => {
    const raw = { name: "test-mcp" };
    assert.deepEqual(validatePluginUX(raw), []);
  });

  it("warns on missing test.endpoint", () => {
    const raw = {
      name: "test-mcp",
      setup: {
        blurb: "Test",
        help: [{ label: "Docs", url: "https://example.com" }],
        fields: [{ key: "X", required: true, help: "h" }],
      },
    };
    const warnings = validatePluginUX(raw);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /test\.endpoint missing/);
  });

  it("warns on required field missing per-field help", () => {
    const raw = {
      name: "test-mcp",
      setup: {
        blurb: "Test",
        help: [{ label: "Docs", url: "https://example.com" }],
        test: { endpoint: "https://api.example.com" },
        fields: [
          { key: "API_KEY", required: true },
          { key: "TIMEOUT", required: false },
        ],
      },
    };
    const warnings = validatePluginUX(raw);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /API_KEY/);
    assert.doesNotMatch(warnings[0], /TIMEOUT/);
  });

  it("accepts setup.links as an alias for setup.help", () => {
    const raw = {
      name: "test-mcp",
      setup: {
        blurb: "Test",
        links: [{ label: "Docs", url: "https://example.com" }],
        test: { endpoint: "https://api.example.com" },
        fields: [{ key: "X", required: true, help: "h" }],
      },
    };
    assert.deepEqual(validatePluginUX(raw), []);
  });
});
