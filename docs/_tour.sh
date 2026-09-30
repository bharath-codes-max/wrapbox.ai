#!/usr/bin/env bash
# Walkthrough harness (needs the dev server on :5980, or BASE=http://host/path).
#   docs/_tour.sh check <case>            run every step instantly; prints per-step JSON
#   docs/_tour.sh shots <case> [outdir]   one still per step (before + after the action)
#   docs/_tour.sh check-all               check every case in src/tour/cases
set -uo pipefail
cd "$(dirname "$0")/.."
BASE="${BASE:-http://localhost:5980}"
BIN="$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell"
W=1280; H=800

run() { # url -> dom on stdout
  local p; p="$(mktemp -d)"
  perl -e 'alarm 60; exec @ARGV' "$BIN" --headless --disable-gpu --hide-scrollbars --no-first-run \
    --user-data-dir="$p" --window-size=$W,$H --virtual-time-budget=45000 --dump-dom "$1" 2>/dev/null
  rm -rf "$p"
}
shot() { # url out.png
  local p; p="$(mktemp -d)"
  perl -e 'alarm 60; exec @ARGV' "$BIN" --headless --disable-gpu --hide-scrollbars --no-first-run \
    --user-data-dir="$p" --window-size=$W,$H --force-device-scale-factor=1 --virtual-time-budget=30000 --screenshot="$2" "$1" >/dev/null 2>&1 || echo "FAILED $2"
  rm -rf "$p"
}
check() {
  local out; out="$(run "$BASE/tour.html?case=$1&check=1" | sed -n 's/.*<pre id="tour-result"[^>]*>\(.*\)<\/pre>.*/\1/p' | head -1)"
  if [ -z "$out" ]; then echo "{\"case\":\"$1\",\"ok\":false,\"errors\":[\"no result — page crashed or case id unknown\"]}"; else
    python3 -c 'import html,sys; print(html.unescape(sys.argv[1]))' "$out"; fi
}
case "${1:-}" in
  check) check "$2" ;;
  check-all)
    for f in src/tour/cases/*.ts; do id="$(basename "$f" .ts)"; [ "$id" = index ] && continue
      check "$id" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(("OK  " if d.get("ok") else "FAIL"), d.get("case"), "" if d.get("ok") else json.dumps([r for r in d.get("results",[]) if r.get("error")]+d.get("errors",[]))[:600])'
    done ;;
  shots)
    id="$2"; out="${3:-/tmp/tour-shots/$id}"; mkdir -p "$out"
    n="$(check "$id" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("steps",0))')"
    for ((i = 0; i < n; i++)); do
      shot "$BASE/tour.html?case=$id&shot=$i" "$out/step-$(printf %02d $i)-a.png" &
      shot "$BASE/tour.html?case=$id&shot=$i&after=1" "$out/step-$(printf %02d $i)-b.png" &
      wait
    done
    ls "$out" ;;
  *) echo "usage: $0 check <case> | check-all | shots <case> [outdir]"; exit 2 ;;
esac
