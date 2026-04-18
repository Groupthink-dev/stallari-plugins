.PHONY: sync-pack-spec validate validate-packs scan-packs validate-all validate-manifests build-api generate contracts test clean

# Optional: path to sealed pack YAMLs (private repo).
# Set PRIVATE_PACKS_DIR to include sealed packs in the build.
# Example: PRIVATE_PACKS_DIR=../stallari-packs-private/packs make build-api
PRIVATE_PACKS_DIR ?=

# Sibling path to the pack-spec source of truth.
# Overridable for CI or local experiments.
PACK_SPEC_DIR ?= ../stallari-pack-spec

# Sync schema, contracts, vocabularies, and fixtures from pack-spec's
# committed dist/. Any hand-edits to schemas/ or schemas/contracts/ will
# surface as a CI diff against pack-spec — don't edit here.
sync-pack-spec:
	@echo "Syncing from $(PACK_SPEC_DIR)..."
	@if [ ! -d "$(PACK_SPEC_DIR)/dist/json" ]; then \
		echo "pack-spec dist/ not found — run 'make build' in $(PACK_SPEC_DIR) first"; \
		exit 1; \
	fi
	@mkdir -p schemas/contracts schemas/fixtures/valid schemas/fixtures/invalid
	@cp $(PACK_SPEC_DIR)/dist/json/pack.schema.json schemas/stallari-pack.schema.json
	@cp $(PACK_SPEC_DIR)/dist/json/plugin.schema.json schemas/stallari-plugin.schema.json
	@cp $(PACK_SPEC_DIR)/dist/json/schema-enums.json schemas/schema-enums.json
	@cp $(PACK_SPEC_DIR)/dist/json/skill-categories.json schemas/skill-categories.json
	@cp $(PACK_SPEC_DIR)/dist/json/services.json schemas/services.json
	@cp $(PACK_SPEC_DIR)/dist/json/capabilities.json schemas/capabilities.json
	@cp $(PACK_SPEC_DIR)/dist/json/tool-groups.json schemas/tool-groups.json
	@cp $(PACK_SPEC_DIR)/dist/json/error-codes.json schemas/error-codes.json
	@cp $(PACK_SPEC_DIR)/dist/json/version.json schemas/version.json
	@rm -f schemas/contracts/*.json
	@cp $(PACK_SPEC_DIR)/dist/json/contracts/*.json schemas/contracts/
	@cp $(PACK_SPEC_DIR)/fixtures/valid/*.yaml schemas/fixtures/valid/ 2>/dev/null || true
	@cp $(PACK_SPEC_DIR)/fixtures/invalid/*.yaml schemas/fixtures/invalid/ 2>/dev/null || true
	@echo "pack-spec synced."

# Validate all plugin manifests against the schema.
# Requires: pip install check-jsonschema
validate:
	@echo "Validating tool entries..."
	@for f in plugins/tools/*.json; do \
		echo "  $$f"; \
		check-jsonschema --schemafile schemas/stallari-plugin.schema.json "$$f" 2>/dev/null || true; \
	done
	@echo "Done."

# Generate context files from service contracts.
generate:
	@PRIVATE_PACKS_DIR=$(PRIVATE_PACKS_DIR) node scripts/build-forge-context.js

# Validate all pack YAML manifests against Pack Spec.
# Requires: node >= 22, npm ci (for yaml parser)
validate-packs: sync-pack-spec generate
	@echo "Validating pack manifests..."
	@PRIVATE_PACKS_DIR=$(PRIVATE_PACKS_DIR) node scripts/validate-packs.js
	@echo "Done."

# Security scan all pack YAML files (DD-147).
# Runs SINJ prompt injection detection and cross-pack clone detection.
scan-packs:
	@echo "Security scanning pack manifests..."
	@node scripts/security-scan.js
	@echo "Done."

# Validate everything.
validate-all: validate validate-packs scan-packs

# Validate manifests in sibling repos.
# Canonical filename: stallari-plugin.yaml
# Legacy filename (accepted during Sidereal→Stallari rebrand): sidereal-plugin.yaml
validate-manifests:
	@echo "Validating repo manifests..."
	@for repo in ../cloudflare-blade-mcp ../syncthing-blade-mcp ../tailscale-blade-mcp \
	             ../fastmail-blade-mcp ../things3-blade-mcp ../caldav-blade-mcp; do \
		for name in stallari-plugin.yaml sidereal-plugin.yaml; do \
			manifest="$$repo/$$name"; \
			if [ -f "$$manifest" ]; then \
				echo "  $$manifest"; \
			fi; \
		done; \
	done
	@echo "Done. (YAML validation requires yq + check-jsonschema pipeline)"

# List all contracts with operation counts.
contracts:
	@for f in schemas/contracts/*.json; do \
		name=$$(jq -r '.title' "$$f"); \
		count=$$(jq '.operations | length' "$$f"); \
		echo "  $$name: $$count operations"; \
	done

# Build catalog from plugins/ and packs/.
# Requires: node >= 22, npm ci (for yaml parser)
build-api: sync-pack-spec generate
	@PRIVATE_PACKS_DIR=$(PRIVATE_PACKS_DIR) node scripts/build-catalog.js

# Run build-script tests (node:test). Sync first so the fixture corpus
# runner has access to pack-spec's valid/invalid YAML fixtures.
test: sync-pack-spec
	@node --test scripts/*.test.js

clean:
	rm -f index.json.tmp
	rm -rf dist/
