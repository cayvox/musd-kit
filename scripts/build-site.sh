#!/usr/bin/env bash
# Build the combined musdkit.xyz artifact: the Astro landing at / with the VitePress
# docs assembled under /docs. Output: landing/dist (deploy this whole directory).
#
#   scripts/build-site.sh
#
# Deploy is a separate, manual step (post npm-publish) — see .github/workflows/deploy-site.yml.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> 1/4  Build the SDK packages (the landing widget imports the shipped @musd-kit/core)"
pnpm -r --filter "./packages/*" run build

echo "==> 2/4  Build the Astro landing → landing/dist"
pnpm --filter @musd-kit/landing build

echo "==> 3/4  Build the VitePress docs under base /docs/ (TypeDoc API ref + VitePress)"
DOCS_BASE=/docs/ pnpm docs:build

echo "==> 4/4  Assemble docs under landing/dist/docs"
rm -rf landing/dist/docs
cp -r docs/.vitepress/dist landing/dist/docs

echo ""
echo "✓ Combined site at landing/dist  (landing at /, docs at /docs/)"
echo "  - $(find landing/dist -name '*.html' | wc -l | tr -d ' ') HTML pages"
echo "  - docs index: landing/dist/docs/index.html"
