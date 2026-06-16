#!/usr/bin/env bash
# Release dry-run + clean-install smoke (THE Phase-10 gate). Proves, with zero assumptions,
# that a real consumer can install the published-shaped tarballs and import @musd-kit/core
# and @musd-kit/react in BOTH module systems — and that the tarballs ship only the intended
# files. Does NOT publish. CI runs this; run it locally with `bash scripts/release-smoke.sh`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== build packages =="
pnpm -r --filter "./packages/*" build >/dev/null

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PACK="$TMP/pack"; PROJ="$TMP/proj"
mkdir -p "$PACK" "$PROJ"

echo "== pnpm pack (rewrites workspace:* → the real version, like publish) =="
CORE_TGZ="$(cd packages/core && pnpm pack --pack-destination "$PACK" | tail -1)"
REACT_TGZ="$(cd packages/react && pnpm pack --pack-destination "$PACK" | tail -1)"

echo "== inspect tarball contents =="
for tgz in "$CORE_TGZ" "$REACT_TGZ"; do
  echo "--- $(basename "$tgz") ---"
  tar tzf "$tgz" | sort
  # Must ship ONLY: package.json, README, LICENSE, and dist/*. Nothing else.
  if tar tzf "$tgz" | grep -vE '^package/(package\.json|README\.md|LICENSE|dist/)' ; then
    echo "FAIL: $(basename "$tgz") ships unexpected files" >&2
    exit 1
  fi
  # Explicitly forbid source / tests / generated source / tsconfig.
  if tar tzf "$tgz" | grep -Eq '^package/(src/|test/|.*\.test\.|tsconfig|.*/_generated/)' ; then
    echo "FAIL: $(basename "$tgz") ships src/test/_generated/tsconfig" >&2
    exit 1
  fi
  # Must include the type declarations.
  tar tzf "$tgz" | grep -q '^package/dist/index.d.ts' || { echo "FAIL: missing dist/index.d.ts" >&2; exit 1; }
done

echo "== clean-install into a fresh project (outside the workspace) =="
cd "$PROJ"
cat > package.json <<'JSON'
{ "name": "consumer-smoke", "private": true, "version": "0.0.0" }
JSON
# Install the packed tarballs + the peers a real consumer needs. Plain npm, no workspace.
npm install --no-audit --no-fund --silent \
  "$CORE_TGZ" "$REACT_TGZ" \
  viem@2.22.8 react@18.2.0 react-dom@18.2.0 wagmi@2.5.12 @tanstack/react-query@5.28.4 \
  typescript@5.7.3 >/dev/null

echo "== ESM import resolves (core + react) =="
node --input-type=module -e "
import { createMusdClient, MusdError, MusdErrorCode } from '@musd-kit/core'
import { useTrove, useOpenTrove } from '@musd-kit/react'
if (typeof createMusdClient !== 'function') throw new Error('core ESM export missing')
if (typeof useTrove !== 'function' || typeof useOpenTrove !== 'function') throw new Error('react ESM hooks missing')
if (typeof MusdError !== 'function' || !MusdErrorCode.BELOW_MINIMUM_DEBT) throw new Error('core errors missing')
console.log('  ESM ok')
"

echo "== CJS require resolves (core) =="
node -e "
const core = require('@musd-kit/core')
if (typeof core.createMusdClient !== 'function') throw new Error('core CJS export missing')
if (!core.MusdErrorCode || !core.MusdErrorCode.ICR_BELOW_MCR) throw new Error('core CJS errors missing')
console.log('  CJS ok')
"

echo "== type-level check (.d.ts loads + types resolve) =="
cat > smoke.ts <<'TS'
import { createMusdClient, type Trove, type OpenPreview, MusdErrorCode } from '@musd-kit/core'
import type { UseOpenTroveResult } from '@musd-kit/react'
const _client: typeof createMusdClient = createMusdClient
const _code: string = MusdErrorCode.BELOW_MINIMUM_DEBT
type _T = Trove['entireDebt'] // bigint
type _P = OpenPreview['meetsMinimum'] // boolean
type _R = UseOpenTroveResult['openTrove'] // the action
TS
cat > tsconfig.json <<'JSON'
{ "compilerOptions": { "strict": true, "noEmit": true, "moduleResolution": "bundler",
  "module": "ESNext", "target": "ES2022", "lib": ["ES2022","DOM"], "jsx": "react-jsx",
  "skipLibCheck": true, "types": [] } }
JSON
./node_modules/.bin/tsc --noEmit
echo "  types ok"

echo "== pnpm publish --dry-run (no publish) =="
cd "$ROOT"
pnpm publish -r --dry-run --no-git-checks

echo "== release smoke PASSED =="
