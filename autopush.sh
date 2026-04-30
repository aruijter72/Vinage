#!/bin/zsh
# autopush.sh — auto-commit and push changes in Architise
# Called by launchd WatchPaths when files change in this folder
#
# Commits immediately on any change, but only pushes (triggering
# GitHub Pages) once every PUSH_INTERVAL_MINUTES minutes.

PUSH_INTERVAL_MINUTES=10

cd "$(dirname "$0")"

# Nothing to do if working tree is clean
git diff --quiet && git diff --staged --quiet && [ -z "$(git ls-files --others --exclude-standard)" ] && exit 0

git add -A
git diff --staged --quiet && exit 0   # staged nothing (e.g. only .DS_Store)

git commit -m "autopush: $(date '+%Y-%m-%d %H:%M:%S')"

# Throttle: only push if we haven't pushed in the last N minutes
LOCK="$(dirname "$0")/.autopush_last_push"
NOW=$(date +%s)
LAST=0
if [ -f "$LOCK" ]; then
  LAST=$(cat "$LOCK")
fi
ELAPSED=$(( NOW - LAST ))
INTERVAL=$(( PUSH_INTERVAL_MINUTES * 60 ))

if [ "$ELAPSED" -ge "$INTERVAL" ]; then
  git push origin main >> "$(dirname "$0")/autopush.log" 2>&1
  echo "$NOW" > "$LOCK"
else
  REMAINING=$(( (INTERVAL - ELAPSED) / 60 ))
  echo "$(date '+%Y-%m-%d %H:%M:%S') — commit saved locally, push in ~${REMAINING}m" >> "$(dirname "$0")/autopush.log"
fi
