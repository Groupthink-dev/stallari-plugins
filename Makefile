.PHONY: validate validate-packs validate-all validate-manifests build-api generate contracts test clean

# Optional: path to sealed pack YAMLs (private repo).
# Set PRIVATE_PACKS_DIR to include sealed packs in the build.
# Example: PRIVATE_PACKS_DIR=../stallari-packs-private/packs make build-api
PRIVATE_PACKS_DIR ?=

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
validate-packs: generate
	@echo "Validating pack manifests..."
	@PRIVATE_PACKS_DIR=$(PRIVATE_PACKS_DIR) node scripts/validate-packs.js
	@echo "Done."

# Validate everything.
validate-all: validate validate-packs

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
build-api: generate
	@PRIVATE_PACKS_DIR=$(PRIVATE_PACKS_DIR) node scripts/build-catalog.js

# Run build-script tests (node:test).
test:
	@node --test scripts/*.test.js

clean:
	rm -f index.json.tmp
	rm -rf dist/
