import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validatePack } from "./validate-packs.js";

// ---------------------------------------------------------------------------
// Helper: minimal valid open pack
// ---------------------------------------------------------------------------

function minimalOpenPack(overrides = {}) {
  return {
    pack: "1.2",
    name: "test-pack",
    description: "A valid test pack",
    version: "1.0.0",
    data: { reads: ["vault"], writes: ["vault"], stores: "nothing", phones_home: false },
    skills: [{ name: "skill-a", prompt: "This is a long enough prompt for validation" }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: minimal valid sealed pack
// ---------------------------------------------------------------------------

function minimalSealedPack(overrides = {}) {
  return {
    pack: "1.2",
    name: "sealed-test",
    description: "A valid sealed test pack",
    version: "1.0.0",
    visibility: "sealed",
    tier: "certified",
    author: { name: "Sidereal", url: "https://sidereal.cc" },
    pricing: { model: "subscription", amount: 9.99, interval: "month" },
    encryption: { method: "aes-256-gcm", key_delivery: "registry-escrow" },
    readme: "# Sealed Pack\nThis is a detailed readme for the sealed pack.",
    data: { reads: ["vault"], writes: ["vault"], stores: "nothing", phones_home: false },
    skills: [
      { name: "skill-a", prompt: "This is a sufficiently long prompt for a sealed skill" },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Open pack validation (baseline)
// ---------------------------------------------------------------------------

describe("validatePack — open packs", () => {
  it("passes for minimal valid open pack", () => {
    const errors = validatePack(minimalOpenPack());
    assert.deepEqual(errors, []);
  });

  it("fails for missing required fields", () => {
    const errors = validatePack({});
    assert.ok(errors.length > 0);
    assert.ok(errors.some(e => e.includes("pack")));
    assert.ok(errors.some(e => e.includes("name")));
    assert.ok(errors.some(e => e.includes("description")));
  });
});

// ---------------------------------------------------------------------------
// Sealed pack validation
// ---------------------------------------------------------------------------

describe("validatePack — sealed packs", () => {
  it("passes for fully valid sealed pack", () => {
    const errors = validatePack(minimalSealedPack());
    assert.deepEqual(errors, []);
  });

  it("requires encryption block", () => {
    const pack = minimalSealedPack();
    delete pack.encryption;
    const errors = validatePack(pack);
    assert.ok(errors.some(e => e.includes("encryption")));
  });

  it("requires encryption.method to be aes-256-gcm", () => {
    const errors = validatePack(minimalSealedPack({
      encryption: { method: "chacha20", key_delivery: "paddle" },
    }));
    assert.ok(errors.some(e => e.includes("aes-256-gcm")));
  });

  it("requires encryption.key_delivery from controlled vocabulary", () => {
    const errors = validatePack(minimalSealedPack({
      encryption: { method: "aes-256-gcm", key_delivery: "magic" },
    }));
    assert.ok(errors.some(e => e.includes("key_delivery")));
  });

  it("accepts all valid key_delivery values", () => {
    for (const kd of ["paddle", "registry-escrow", "direct"]) {
      const errors = validatePack(minimalSealedPack({
        encryption: { method: "aes-256-gcm", key_delivery: kd },
      }));
      assert.deepEqual(errors, [], `should accept key_delivery: ${kd}`);
    }
  });

  it("requires pricing block", () => {
    const pack = minimalSealedPack();
    delete pack.pricing;
    const errors = validatePack(pack);
    assert.ok(errors.some(e => e.includes("pricing")));
  });

  it("rejects pricing.model free for sealed packs", () => {
    const errors = validatePack(minimalSealedPack({
      pricing: { model: "free" },
    }));
    assert.ok(errors.some(e => e.includes('free')));
  });

  it("requires readme", () => {
    const pack = minimalSealedPack();
    delete pack.readme;
    const errors = validatePack(pack);
    assert.ok(errors.some(e => e.includes("readme")));
  });

  it("requires tier certified or verified", () => {
    const errors = validatePack(minimalSealedPack({ tier: "community" }));
    assert.ok(errors.some(e => e.includes("certified") || e.includes("verified")));
  });

  it("rejects sealed pack with no tier", () => {
    const pack = minimalSealedPack();
    delete pack.tier;
    const errors = validatePack(pack);
    assert.ok(errors.some(e => e.includes("tier")));
  });

  it("rejects skill prompts shorter than 20 chars", () => {
    const errors = validatePack(minimalSealedPack({
      skills: [{ name: "short", prompt: "too short" }],
    }));
    assert.ok(errors.some(e => e.includes("too short") || e.includes("min 20")));
  });

  it("accepts skill prompts >= 20 chars", () => {
    const errors = validatePack(minimalSealedPack({
      skills: [{ name: "ok", prompt: "This prompt is exactly twenty chars!!" }],
    }));
    assert.deepEqual(errors, []);
  });

  it("does not apply sealed rules to open packs", () => {
    // Open pack with no encryption, no pricing, community tier — should pass
    const errors = validatePack(minimalOpenPack({
      tier: "community",
    }));
    assert.deepEqual(errors, []);
  });
});

// ---------------------------------------------------------------------------
// DD-120 Phase 0 — third-party sealed distribution gate
// ---------------------------------------------------------------------------

describe("validatePack — DD-120 sealed distribution gate", () => {
  it("allows sealed + public from first-party author", () => {
    const errors = validatePack(minimalSealedPack());
    assert.deepEqual(errors, []);
  });

  it("rejects sealed + public with no author", () => {
    const pack = minimalSealedPack();
    delete pack.author;
    const errors = validatePack(pack);
    assert.ok(errors.some(e => e.includes("DD-120")));
  });

  it("rejects sealed + public from third-party author", () => {
    const errors = validatePack(minimalSealedPack({
      author: { name: "Third Party", url: "https://example.com" },
    }));
    assert.ok(errors.some(e => e.includes("DD-120")));
  });

  it("rejects sealed + explicit public from non-first-party", () => {
    const errors = validatePack(minimalSealedPack({
      access: "public",
      author: { name: "Third Party", url: "https://example.com" },
    }));
    assert.ok(errors.some(e => e.includes("DD-120")));
  });

  it("allows sealed + private from any author", () => {
    const errors = validatePack(minimalSealedPack({
      access: "private",
      organization: "third-party-org",
      author: { name: "Third Party", url: "https://example.com" },
      pricing: undefined,  // private sealed packs don't require pricing
    }));
    assert.deepEqual(errors, []);
  });

  it("allows sealed + private with no author", () => {
    const pack = minimalSealedPack({
      access: "private",
      organization: "some-org",
      pricing: undefined,
    });
    delete pack.author;
    const errors = validatePack(pack);
    assert.deepEqual(errors, []);
  });
});
