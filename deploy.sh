#!/usr/bin/env bash
# deploy.sh — bump cache-bust version, then deploy to Firebase Hosting + Functions
#
# Usage:
#   ./deploy.sh             → hosting only
#   ./deploy.sh functions   → hosting + functions

cd "$(dirname "$0")"

# ── 1. Bump ?v= timestamp in app.html + SW_VERSION in sw.js ─────────────────
TS=$(date +%s)
# macOS sed requires -i '', Linux sed requires -i (no argument)
if [[ "$(uname)" == "Darwin" ]]; then
  sed -i '' "s|\.css?v=[^\"']*|.css?v=${TS}|g; s|\.js?v=[^\"']*|.js?v=${TS}|g" app.html
  sed -i '' "s|const SW_VERSION = '[^']*'|const SW_VERSION = 'v${TS}'|" sw.js
else
  sed -i "s|\.css?v=[^\"']*|.css?v=${TS}|g; s|\.js?v=[^\"']*|.js?v=${TS}|g" app.html
  sed -i "s|const SW_VERSION = '[^']*'|const SW_VERSION = 'v${TS}'|" sw.js
fi
echo "✓ Cache versie bijgewerkt → ${TS}"

# ── 2. Deploy to Firebase ─────────────────────────────────────────────────────
if [[ "$1" == "functions" ]]; then
  echo "→ Deploying hosting + functions…"
  firebase deploy --only functions,hosting
else
  echo "→ Deploying hosting…"
  firebase deploy --only hosting
fi
