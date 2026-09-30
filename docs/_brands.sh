#!/usr/bin/env bash
# Fetches real brand marks for the portfolio deck into src/portfolio/brands/.
# Source order: Simple Icons (official SVG marks) → the brand's own favicon (Google's favicon service).
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=src/portfolio/brands; mkdir -p "$OUT"
# name|simpleicons-slug|domain
BRANDS="
replit|replit|replit.com
supabase|supabase|supabase.com
nx|nx|nx.dev
wiz||wiz.io
euronews||euronews.com
theregister||theregister.com
ibm|ibm|ibm.com
netskope||netskope.com
gartner||gartner.com
owasp|owasp|owasp.org
nist||nist.gov
eu||european-union.europa.eu
zscaler||zscaler.com
paloalto|paloaltonetworks|paloaltonetworks.com
kong|kong|konghq.com
cloudflare|cloudflare|cloudflare.com
portkey||portkey.ai
zenity||zenity.io
noma||noma.security
promptsecurity||prompt.security
sentinelone|sentinelone|sentinelone.com
lakera||lakera.ai
checkpoint|checkpoint|checkpoint.com
oso||osohq.com
protectai||protectai.com
calypsoai||calypsoai.com
f5|f5|f5.com
cisco|cisco|cisco.com
astrix||astrix.security
stackoverflow|stackoverflow|stackoverflow.com
googlecloud|googlecloud|cloud.google.com
metr||metr.org
forrester||forrester.com
csa||cloudsecurityalliance.org
crunchbase|crunchbase|crunchbase.com
generalanalysis||generalanalysis.com
invariant||invariantlabs.ai
obsidian||obsidiansecurity.com
cyberark|cyberark|cyberark.com
"
echo "$BRANDS" | while IFS='|' read -r name slug domain; do
  [ -z "$name" ] && continue
  ok=0
  if [ -n "$slug" ]; then
    if curl -fsSL --max-time 15 "https://cdn.simpleicons.org/$slug" -o "$OUT/$name.svg" && grep -q "<svg" "$OUT/$name.svg"; then ok=1; else rm -f "$OUT/$name.svg"; fi
  fi
  if [ $ok = 0 ]; then
    if curl -fsSL --max-time 15 "https://www.google.com/s2/favicons?domain=$domain&sz=128" -o "$OUT/$name.png" && [ "$(stat -f%z "$OUT/$name.png")" -gt 400 ]; then ok=1; else rm -f "$OUT/$name.png"; fi
  fi
  echo "$name: $([ $ok = 1 ] && echo ok || echo MISSING)"
done
ls -la "$OUT" | awk '{print $5, $9}'
