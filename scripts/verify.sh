#!/usr/bin/env bash
# Runs exactly what .github/workflows/ci.yml runs, in the same order, so a push never fails CI.
# Usage: pnpm verify        (the pre-push hook runs this automatically before pushing main)
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

# ---- job: contracts
step "forge fmt --check"
(cd contracts && forge fmt --check)
step "forge build --sizes"
(cd contracts && forge build --sizes >/dev/null)
step "forge test"
(cd contracts && forge test)

# ---- job: typescript
step "ABIs are regenerated and committed"
node services/common/scripts/gen-abi.mjs
git diff --exit-code services/common/src/abis.ts
step "envio codegen"
pnpm --filter indexer codegen >/dev/null
step "typecheck"
pnpm typecheck
step "common + underwriter tests"
pnpm --filter @mandate/common test
pnpm --filter underwriter test
step "app build"
pnpm --filter app build >/dev/null

printf '\n\033[32m✓ everything CI checks passed locally\033[0m\n'
