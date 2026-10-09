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

# ---- job: formal
step "halmos (symbolic proofs of the rules)"
if command -v halmos >/dev/null; then
  (cd contracts && halmos --contract RuleProofs --solver-command "python test/formal/yices_all_logic.py" >/dev/null)
else
  echo "  halmos not installed (pip install halmos==0.3.3), runs in CI"
fi

# ---- job: typescript
step "ABIs are regenerated and committed"
node services/common/scripts/gen-abi.mjs
git diff --exit-code services/common/src/abis.ts
step "envio codegen"
# Envio ships no Windows binary, so on Windows this one step can only run in CI (Linux). The generated types from the
# last Linux/WSL run stay in place, so the indexer still typechecks below. Indexer config or schema changes: run
# codegen in WSL before pushing.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) echo "  skipped on Windows (runs in CI): if you changed indexer/config.yaml or schema.graphql, run codegen in WSL" ;;
  *) pnpm --filter indexer codegen >/dev/null ;;
esac
step "typecheck"
pnpm typecheck
step "common + underwriter tests"
pnpm --filter @mandate/common test
pnpm --filter underwriter test
step "app build"
pnpm --filter app build >/dev/null

printf '\n\033[32m✓ everything CI checks passed locally\033[0m\n'
