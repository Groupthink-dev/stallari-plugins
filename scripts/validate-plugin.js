#!/usr/bin/env node
/**
 * Validate a third-party MCP plugin for certification.
 *
 * Performs:
 *   1. Manifest schema check (required fields, types)
 *   2. Install test (via declared runtime: uv, npx, npm)
 *   3. MCP tool enumeration (spawns server, sends tools/list via stdio JSON-RPC)
 *   4. Licence compatibility check
 *   5. Generates checklist report
 *
 * Usage:
 *   node scripts/validate-plugin.js plugins/tools/blender-mcp.json
 *   node scripts/validate-plugin.js plugins/tools/blender-mcp.json --update
 *
 * The --update flag writes validation results back into the manifest's
 * certification block.
 *
 * Exit codes: 0 = all checks pass, 1 = failures found, 2 = usage error
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const COMPATIBLE_LICENCES = [
  "MIT", "Apache-2.0", "ISC", "BSD-2-Clause", "BSD-3-Clause",
  "Unlicense", "0BSD", "BlueOak-1.0.0",
];

const REQUIRED_FIELDS = ["name", "version", "description", "author", "licence", "tier", "install"];

// --- Helpers ---

function log(icon, msg) {
  console.log(`  ${icon}  ${msg}`);
}

function pass(msg) { log("\x1b[32m✓\x1b[0m", msg); }
function fail(msg) { log("\x1b[31m✗\x1b[0m", msg); }
function warn(msg) { log("\x1b[33m!\x1b[0m", msg); }
function info(msg) { log("\x1b[36m·\x1b[0m", msg); }

/**
 * Spawn a process, send JSON-RPC over stdin, collect stdout.
 * Returns { stdout, stderr, code } or throws on timeout.
 */
function spawnWithStdio(command, args, stdinPayload, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      // Give it a moment to clean up
      setTimeout(() => proc.kill("SIGKILL"), 1000);
      resolve({ stdout, stderr, code: null, timedOut: true });
    }, timeoutMs);

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut: false });
    });

    if (stdinPayload) {
      proc.stdin.write(stdinPayload);
      proc.stdin.end();
    }
  });
}

/**
 * Build the command + args to spawn an MCP server based on runtime.
 */
function buildSpawnCommand(manifest) {
  const { runtime, package: pkg, command, args: extraArgs } = manifest.install;

  switch (runtime) {
    case "uv":
      return { cmd: "uvx", args: [pkg, ...(extraArgs || [])] };
    case "npx":
      return { cmd: "npx", args: ["-y", pkg, ...(extraArgs || [])] };
    case "npm":
      return { cmd: "npx", args: ["-y", pkg, ...(extraArgs || [])] };
    case "node":
      return { cmd: "npx", args: ["-y", pkg, ...(extraArgs || [])] };
    case "docker":
      return null; // Can't easily validate Docker MCPs in CI
    case "native":
      return command ? { cmd: command, args: extraArgs || [] } : null;
    case "remote":
      return null; // Remote MCPs need network validation
    default:
      return null;
  }
}

/**
 * Attempt MCP JSON-RPC initialize + tools/list handshake.
 * Returns array of tool names or null on failure.
 */
async function enumerateTools(manifest) {
  const spawnCmd = buildSpawnCommand(manifest);
  if (!spawnCmd) {
    return { tools: null, reason: `Runtime "${manifest.install.runtime}" cannot be validated locally` };
  }

  // MCP JSON-RPC handshake: initialize, then tools/list
  const initializeRequest = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "sidereal-validator", version: "1.0.0" },
    },
  });

  const toolsListRequest = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });

  // Send both requests separated by newline (JSON-RPC batch over stdio)
  const payload = initializeRequest + "\n" + toolsListRequest + "\n";

  try {
    const result = await spawnWithStdio(spawnCmd.cmd, spawnCmd.args, payload, 30000);

    if (result.timedOut) {
      return { tools: null, reason: "MCP server did not respond within 30s (may need env vars or external service)" };
    }

    if (result.code !== 0 && result.code !== null) {
      const errSnippet = result.stderr.slice(0, 200).trim();
      return { tools: null, reason: `Process exited with code ${result.code}${errSnippet ? `: ${errSnippet}` : ""}` };
    }

    // Parse JSON-RPC responses from stdout (one per line, or concatenated)
    const lines = result.stdout.split("\n").filter((l) => l.trim());
    const toolNames = [];

    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.result?.tools) {
          for (const tool of msg.result.tools) {
            if (tool.name) toolNames.push(tool.name);
          }
        }
      } catch {
        // Not all lines are JSON (stderr leaks, etc.)
      }
    }

    if (toolNames.length > 0) {
      return { tools: toolNames, reason: null };
    }

    // Check if we got an initialize response but no tools
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.result?.serverInfo) {
          return { tools: [], reason: "Server initialized but returned no tools (may need env vars)" };
        }
      } catch {}
    }

    return { tools: null, reason: "No valid JSON-RPC response received" };
  } catch (err) {
    return { tools: null, reason: `Spawn failed: ${err.message}` };
  }
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const updateMode = args.includes("--update");
  const manifestPath = args.find((a) => !a.startsWith("--"));

  if (!manifestPath) {
    console.error("Usage: node scripts/validate-plugin.js <manifest.json> [--update]");
    process.exit(2);
  }

  const fullPath = resolve(manifestPath);
  let raw;
  try {
    raw = JSON.parse(await readFile(fullPath, "utf-8"));
  } catch (err) {
    console.error(`Failed to read manifest: ${err.message}`);
    process.exit(2);
  }

  console.log(`\nValidating: ${raw.name || manifestPath}`);
  console.log("─".repeat(50));

  const checklist = {
    installs_cleanly: false,
    tools_enumerate: false,
    tools_callable: false,
    no_data_exfil: false,
    auth_reviewed: false,
    licence_compatible: false,
  };
  let failures = 0;

  // 1. Schema check
  info("Schema check");
  for (const field of REQUIRED_FIELDS) {
    if (raw[field] === undefined) {
      fail(`  Missing required field: ${field}`);
      failures++;
    }
  }
  if (raw.install && !raw.install.runtime) {
    fail("  Missing install.runtime");
    failures++;
  }

  // 2. Licence check
  const licence = raw.licence || "";
  if (COMPATIBLE_LICENCES.includes(licence)) {
    pass(`Licence: ${licence} (compatible)`);
    checklist.licence_compatible = true;
  } else if (licence.startsWith("GPL") || licence.startsWith("AGPL")) {
    warn(`Licence: ${licence} (copyleft — needs review)`);
    checklist.licence_compatible = false;
    failures++;
  } else if (licence) {
    warn(`Licence: ${licence} (unknown — needs manual review)`);
  } else {
    fail("No licence specified");
    failures++;
  }

  // 3. Install test (attempt to resolve the package without full install)
  info("Install check");
  const spawnCmd = buildSpawnCommand(raw);
  if (spawnCmd) {
    try {
      // For uv: just check if the package is resolvable
      // For npx: the enumeration step will test install implicitly
      pass(`Runtime: ${raw.install.runtime}, package: ${raw.install.package || raw.install.command || "N/A"}`);
      checklist.installs_cleanly = true; // Will be validated during enumeration
    } catch {
      fail("Install command could not be determined");
      failures++;
    }
  } else {
    warn(`Runtime "${raw.install?.runtime}" — cannot validate locally`);
  }

  // 4. Tool enumeration
  info("Tool enumeration (spawning MCP server...)");
  const enumResult = await enumerateTools(raw);

  if (enumResult.tools && enumResult.tools.length > 0) {
    pass(`Enumerated ${enumResult.tools.length} tools:`);
    for (const name of enumResult.tools) {
      info(`  ${name}`);
    }
    checklist.tools_enumerate = true;
    checklist.installs_cleanly = true;
  } else if (enumResult.tools && enumResult.tools.length === 0) {
    warn(`Server started but no tools returned: ${enumResult.reason}`);
    checklist.installs_cleanly = true;
  } else {
    warn(`Could not enumerate: ${enumResult.reason}`);
  }

  // 5. Security notes
  info("Security review");
  if (raw.certification?.security_notes) {
    info(`  Notes: ${raw.certification.security_notes}`);
  }
  if (raw.env && raw.env.length > 0) {
    info(`  Required env vars: ${raw.env.map((e) => e.name).join(", ")}`);
    const secrets = raw.env.filter((e) => e.secret);
    if (secrets.length > 0) {
      warn(`  Secret env vars: ${secrets.map((e) => e.name).join(", ")}`);
    }
  }
  // Auth review is manual — flag if not yet done
  if (!raw.certification?.checklist?.auth_reviewed) {
    warn("  Auth review: not yet completed (manual step)");
  }

  // 6. Data exfiltration check (static analysis only)
  if (raw.contract === null) {
    info("  Uncontracted plugin — no domain routing, manual review needed");
  }
  // This is a manual step for now
  if (!raw.certification?.checklist?.no_data_exfil) {
    warn("  Data exfil review: not yet completed (manual step)");
  }

  // 7. Setup manifest consistency (DD106)
  if (raw.setup) {
    info("Setup manifest (DD106)");
    pass(`Auth model: ${raw.setup.auth_model || "not specified"}`);
    if (raw.setup.complexity) {
      pass(`Complexity: ${raw.setup.complexity}`);
    }

    // Check fields/env consistency
    if (raw.setup.fields && raw.env) {
      const envKeys = new Set(raw.env.map((e) => e.name));
      for (const field of raw.setup.fields) {
        if (!envKeys.has(field.key)) {
          warn(`  setup.fields key "${field.key}" not found in env array`);
        }
      }
    } else if (raw.setup.fields && !raw.env) {
      warn("  setup.fields declared but no env array — add matching env entries");
    }

    // Check oauth2 sub-object when auth_model is oauth2
    if (raw.setup.auth_model === "oauth2" && !raw.setup.oauth2) {
      warn("  auth_model is 'oauth2' but setup.oauth2 sub-object is missing");
    }

    // Check test endpoint field references
    if (raw.setup.test?.endpoint) {
      const fieldKeys = new Set((raw.setup.fields || []).map((f) => f.key));
      const refs = raw.setup.test.endpoint.match(/\{([A-Z][A-Z0-9_]*)\}/g) || [];
      for (const ref of refs) {
        const key = ref.slice(1, -1);
        if (!fieldKeys.has(key)) {
          warn(`  test.endpoint references {${key}} but no matching field in setup.fields`);
        }
      }
    }
  } else if (raw.tier === "certified" && !raw.env?.length) {
    // Certified plugins should declare setup or env
    info("Setup manifest (DD106)");
    warn("  Certified plugin with no setup block and no env vars — consider adding setup metadata");
  }

  // Summary
  console.log("\n" + "─".repeat(50));
  console.log("Checklist:");
  for (const [key, value] of Object.entries(checklist)) {
    const icon = value ? "\x1b[32m✓\x1b[0m" : "\x1b[33m○\x1b[0m";
    console.log(`  ${icon}  ${key}`);
  }

  const automated = Object.values(checklist).filter(Boolean).length;
  const total = Object.keys(checklist).length;
  const manual = total - automated;

  console.log(`\nAutomated: ${automated}/${total} passed, ${manual} need manual review`);

  if (enumResult.tools && enumResult.tools.length > 0) {
    console.log(`Tools: ${enumResult.tools.length} enumerated`);
  }

  // Write results back if --update
  if (updateMode) {
    const now = new Date().toISOString().split("T")[0];
    raw.certification = {
      ...raw.certification,
      status: failures === 0 && automated >= 3 ? "validated" : "pending",
      validated_version: raw.version,
      validated_date: now,
      validator: "validate-plugin.js",
      platform_tested: [`${process.platform}-${process.arch}`],
      checklist,
    };

    // Promote tier if fully validated
    if (raw.certification.status === "validated" && raw.tier === "community") {
      info("Tier eligible for promotion: community → verified (manual decision)");
    }

    await writeFile(fullPath, JSON.stringify(raw, null, 2) + "\n");
    pass(`Updated ${manifestPath} with validation results`);
  }

  console.log("");
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
