# Lambert — convenience wrapper over the pnpm scripts. Requires the carapace checkout as a sibling
# (../carapace) — the renderer bundles its source and the main process bundles @carapace/shell.
.DEFAULT_GOAL := help
PNPM := pnpm

.PHONY: help install dev build test typecheck check selftest goldens dist dist-linux dist-win dist-mac clean

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies (frozen lockfile)
	$(PNPM) install --frozen-lockfile

dev: ## Run the app in development (hot reload)
	$(PNPM) dev

build: ## Build main/preload/renderer into out/
	$(PNPM) build

test: ## Run the unit test suite
	$(PNPM) test

typecheck: ## Type-check without emitting
	$(PNPM) typecheck

check: typecheck test ## Type-check + tests (the pre-commit gate)

selftest: ## Build + run the GPU==CPU parity self-test (needs WebGPU)
	$(PNPM) selftest

goldens: ## Regenerate the NX golden fixture
	$(PNPM) gen-goldens

dist: ## Package installers for the host platform (-> release/)
	$(PNPM) dist

dist-linux: ## Package Debian (.deb) + Fedora (.rpm) installers
	$(PNPM) dist:linux

dist-win: ## Package the Windows (NSIS) installer
	$(PNPM) dist:win

dist-mac: ## Package the macOS (.dmg + .zip) installers
	$(PNPM) dist:mac

clean: ## Remove build + packaging output
	rm -rf out release dist
