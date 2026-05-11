#!/bin/zsh
# deploy.sh — bump cache-bust version, then deploy to Firebase Hosting + Functions
#
# Usage:
#   ./deploy.sh             → hosting only
#   ./deploy.sh functions   → hosting + functions

cd "$(dirname "$0")"

# ── 1. Bump ?v= timestamp in index.html + SW_VERSION in sw.js ────────────────
TS=$(date +%s)
sed -i '' "s|\.css?v=[^\"']*|.css?v=${TS}|g; s|\.js?v=[^\"']*|.js?v=${TS}|g" index.html
sed -i '' "s|const SW_VERSION = '[^']*'|const SW_VERSION = 'v${TS}'|" sw.js
echo "✓ Cache versie bijgewerkt → ${TS}"

# ── 2. Deploy to Firebase ─────────────────────────────────────────────────────
if [[ "$1" == "functions" ]]; then
  echo "→ Deploying hosting + functions…"
  firebase deploy --only functions,hosting
else
  echo "→ Deploying hosting…"
  firebase deploy --only hosting
fi
