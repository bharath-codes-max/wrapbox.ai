#!/usr/bin/env bash
# Captures product screenshots for the portfolio deck from the running dev server (port 5980)
# with the Playwright headless shell — dark and light, fresh profile each (demo workspace, no
# local state). Virtual time lets route animations and count-ups settle before the capture.
set -uo pipefail
cd "$(dirname "$0")/.."
SHELL_BIN="$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell"
OUT="src/portfolio/shots"; mkdir -p "$OUT"
ROUTES=(start control live agents tasks intent safety simulator reviews standing breakglass coverage trust evidence simlab integrations vault brain settings onboarding/admin)
for theme in dark light; do
  profile="$(mktemp -d)"
  for r in "${ROUTES[@]}"; do
    name="${r//\//-}"
    perl -e 'alarm 45; exec @ARGV' "$SHELL_BIN" --headless --disable-gpu --hide-scrollbars --no-first-run \
      --user-data-dir="$profile" --window-size=1600,1000 --force-device-scale-factor=1.25 \
      --virtual-time-budget=8000 --screenshot="$OUT/$name-$theme.png" \
      "http://localhost:5980/?theme=$theme#$r" >/dev/null 2>&1 || echo "FAILED $r $theme"
    if [ -f "$OUT/$name-$theme.png" ]; then
      sips -s format jpeg -s formatOptions 82 "$OUT/$name-$theme.png" --out "$OUT/$name-$theme.jpg" >/dev/null && rm "$OUT/$name-$theme.png"
    fi
  done
  rm -rf "$profile"
done
ls -la "$OUT" | awk '{print $5, $9}'
