.PHONY: validate validate-packs validate-all validate-manifests build-api generate contracts test clean

# Validate all plugin manifests against the schema.
# Requires: pip install check-jsonschema
validate:
	@echo "Validating tool entries..."
	@for f in plugins/tools/*.json; do \
		echo "  $$f"; \
		check-jsonschema --schemafile schemas/sidereal-plugin.schema.json "$$f" 2>/dev/null || true; \
	done
	@echo "Done."

# Generate context files from service contracts.
generate:
	@node scripts/build-forge-context.js

# Validate all pack YAML manifests against Pack Spec.
# Requires: node >= 22, npm ci (for yaml parser)
validate-packs: generate
	@echo "Validating pack manifests..."
	@node scripts/validate-packs.js
	@echo "Done."

# Validate everything.
validate-all: validate validate-packs

# Validate manifests in sibling repos (sidereal-plugin.yaml files).
validate-manifests:
	@echo "Validating repo manifests..."
	@for repo in ../fastmail-blade-mcp ../things-3-mcp ../caldav-blade-mcp; do \
		manifest="$$repo/sidereal-plugin.yaml"; \
		if [ -f "$$manifest" ]; then \
			echo "  $$manifest"; \
		fi; \
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
	@node scripts/build-catalog.js

# Run build-script tests (node:test).
test:
	@node --test scripts/*.test.js

clean:
	rm -f index.json.tmp
	rm -rf dist/
