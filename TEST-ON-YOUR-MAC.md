# Test Wrapbox end-to-end on your Mac (about 20 minutes)

Prereqs: node 20+ and Xcode command-line tools (you already have both).
Everything runs under `/tmp/wrapbox-demo` — nothing touches your real config.
When you're done, one `rm -rf /tmp/wrapbox-demo` cleans up.

This walks the **Network MVP**: the kernel floor (step 4), destination-level
enforcement (steps 5–6b), and **content inspection of the decrypted request
body** (step 6c) — secrets, PII, source code and financial/PHI/legal/confidential
documents, including files inside multipart uploads.

Every service is local: control plane on `localhost:4100`, proxy on
`127.0.0.1:4180`, UI on `localhost:5173`. Only the *destinations* you test
against are external — `localhost` destinations are deliberately never
inspected (see the note in step 6c).

## 0. One-time setup (Terminal, ~5 min)

```sh
cd ~/Music/wrapbox-prototype

# Install everything (first run only).
(cd control-plane && npm install)
(cd packages/policy-core && npm install && npm run build)
(cd runtime && npm install)
npm install                    # the prototype UI
```

Open **three terminal tabs**. You'll leave two of them running.

## 1. Start the Control Plane (tab A, leave running)

```sh
cd ~/Music/wrapbox-prototype/control-plane
DB_PATH=/tmp/wrapbox-demo/cp.db PORT=4100 npm run dev
```

Wait for: `🔒 Wrapbox Control Plane running on http://localhost:4100`.

## 2. Enroll the daemon (tab B)

```sh
mkdir -p /tmp/wrapbox-demo
export WRAPBOX_HOME=/tmp/wrapbox-demo/home
export CP=http://localhost:4100
export A='X-Admin-Key: wbx-admin-dev'

# Create your test org.
ORG=$(curl -s -H "$A" -H 'content-type: application/json' \
  -d '{"name":"TestCo","domain":"testco.example"}' \
  $CP/v1/orgs | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "ORG=$ORG" > /tmp/wrapbox-demo/env.sh

# Mint a single-use enrollment token.
TOK=$(curl -s -H "$A" -H 'content-type: application/json' \
  -d "{\"org_id\":\"$ORG\"}" $CP/v1/enroll-tokens \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

# Enroll this laptop.
cd ~/Music/wrapbox-prototype/runtime
npx tsx src/cli.ts enroll --server $CP --org "$ORG" --token "$TOK" --no-wrap

# Write starter rules: block .env reads, block openai.com egress, allow the rest.
curl -s -H "$A" -H 'content-type: application/json' \
  -d "{\"org_id\":\"$ORG\",\"name\":\"Block .env reads\",\"effect\":\"block\",\"priority\":100,\"condition\":{\"field\":\"tool_input.path\",\"op\":\"contains\",\"value\":\".env\"}}" \
  $CP/v1/rules >/dev/null
curl -s -H "$A" -H 'content-type: application/json' \
  -d "{\"org_id\":\"$ORG\",\"name\":\"Block openai.com egress\",\"effect\":\"block\",\"priority\":90,\"condition\":{\"field\":\"tool_input.host\",\"op\":\"contains\",\"value\":\"openai.com\"}}" \
  $CP/v1/rules >/dev/null
curl -s -H "$A" -H 'content-type: application/json' \
  -d "{\"org_id\":\"$ORG\",\"name\":\"Allow everything else\",\"effect\":\"allow\",\"priority\":10}" \
  $CP/v1/rules >/dev/null

# Pull the rules to this device.
npx tsx src/cli.ts pull
```

## 3. See every AI agent on your Mac (discovery)

```sh
cd ~/Music/wrapbox-prototype/runtime
npx tsx src/cli.ts discover
```

You'll get a table of registry-known agents actually installed on this machine
(claude-code, codex-cli, cursor, chatgpt-desktop, mcp-servers, etc.).

Push the inventory to the Control Plane:

```sh
npx tsx src/cli.ts scan
```

Verify the server has them:

```sh
curl -s -H "$A" "$CP/v1/devices?org_id=$ORG" | python3 -m json.tool
curl -s -H "$A" "$CP/v1/agents?org_id=$ORG" | python3 -m json.tool
```

## 4. Prove the kernel actually blocks `.env` (Seatbelt floor)

```sh
mkdir -p /tmp/wrapbox-demo/proj
echo "FAKE_KEY=only-for-testing" > /tmp/wrapbox-demo/proj/.env
echo "hello" > /tmp/wrapbox-demo/proj/normal.txt

cd /tmp/wrapbox-demo/proj

# Try to read .env from inside the sandbox — the KERNEL refuses.
npx tsx ~/Music/wrapbox-prototype/runtime/src/cli.ts run -- /bin/cat .env
# → cat: .env: Operation not permitted
# → wrapboxd: session ... exited 1; 1 violation receipt(s) written

# Same read outside the sandbox — succeeds (proves it's the sandbox, not perms).
/bin/cat .env

# Normal files still work inside the sandbox.
npx tsx ~/Music/wrapbox-prototype/runtime/src/cli.ts run -- /bin/cat normal.txt
# → hello

# Even python can't escape — this is the kernel, not a script check.
npx tsx ~/Music/wrapbox-prototype/runtime/src/cli.ts run -- python3 -c "open('.env').read()"
# → PermissionError: [Errno 1] Operation not permitted
```

## 5. Prove the universal proxy blocks by network destination (any agent)

```sh
cd ~/Music/wrapbox-prototype/runtime

# Start the daemon; it starts the proxy on 127.0.0.1:4180.
npx tsx src/cli.ts daemon &
DAEMON_PID=$!
sleep 2

# Unattributed process reaching a MODEL API is blocked even if there's no
# specific rule — the model-API guard fires. This is the "any agent" line.
curl -sx http://127.0.0.1:4180 -o /dev/null -w 'HTTP %{http_code}\n' \
  http://api.anthropic.com/
# → HTTP 403

# openai.com — the block rule fires; reason keeps the rule name AND the guard.
curl -sx http://127.0.0.1:4180 -o /dev/null -w 'HTTP %{http_code}\n' \
  http://api.openai.com/v1/models
# → HTTP 403

# HTTPS with the plain daemon: the decision is made at the CONNECT line, on the
# hostname alone — the body is never seen. That is still enough to refuse the
# whole tunnel. To govern what is INSIDE an allowed HTTPS request, see step 6c.
curl -sx http://127.0.0.1:4180 -o /dev/null -w 'HTTP %{http_code}\n' \
  https://api.openai.com/
# → curl reports "CONNECT tunnel failed, response 403"

# Stop the daemon when you're done poking.
kill $DAEMON_PID
```

Every one of those attempts wrote a signed receipt:

```sh
tail -5 $WRAPBOX_HOME/receipts.jsonl | python3 -m json.tool
```

## 6. Prove the evidence chain is tamper-evident

```sh
cd ~/Music/wrapbox-prototype/runtime

# Local verify: recompute every signature + chain link.
npx tsx src/cli.ts verify
# → Chain OK: N receipt(s), verified through seq N.

# Ship the chain to the server.
npx tsx src/cli.ts sync

# Server auditor endpoint — this is what a customer's auditor would run.
DEV=$(python3 -c "import json;print(json.load(open('$WRAPBOX_HOME/config.json'))['device_id'])")
curl -s -H "$A" "$CP/v1/evidence/verify?org_id=$ORG&device_id=$DEV" \
  | python3 -m json.tool
# → { "chain_ok": true, "verified_through_seq": N, "breaks": [] }

# Tamper: change one byte in a middle receipt.
python3 -c "
import sys
p = '$WRAPBOX_HOME/receipts.jsonl'
lines = open(p).readlines()
if len(lines) >= 3:
    lines[len(lines)//2] = lines[len(lines)//2].replace('block', 'aLLoW', 1)
    open(p,'w').write(''.join(lines))
"
npx tsx src/cli.ts verify
# → Reports the break by seq number.
```

## 6b. Govern browser-based AI (ChatGPT web, Gemini web, Claude.ai)

A browser agent runs on the vendor's servers, so it can never read a file on
the laptop — the kernel test above does not apply to it. What Wrapbox governs
for browser agents is the **network**: which AI sites the browser may reach,
with every attempt recorded. (This is the "employees must not paste our code
into unapproved AI tools" control.)

Add website rules — block two AI sites, approve one:

```sh
for spec in "Block ChatGPT website|block|150|chatgpt.com" \
            "Block Gemini website|block|150|gemini.google.com" \
            "Allow Claude website (approved)|allow|140|claude.ai"; do
  IFS='|' read -r name eff pri host <<< "$spec"
  curl -s -H "$A" -H 'content-type: application/json' \
    -d "{\"org_id\":\"$ORG\",\"name\":\"$name\",\"effect\":\"$eff\",\"priority\":$pri,\"condition\":{\"field\":\"tool_input.host\",\"op\":\"contains\",\"value\":\"$host\"}}" \
    $CP/v1/rules >/dev/null && echo "+ $name"
done
cd ~/Music/wrapbox-prototype/runtime && npx tsx src/cli.ts pull
```

With the daemon running (step 5), open a Chrome window that routes through the
Wrapbox proxy. It uses its own profile folder, so your normal Chrome is untouched:

```sh
open -na "Google Chrome" --args \
  --proxy-server="http://127.0.0.1:4180" \
  --user-data-dir=/tmp/wrapbox-demo/chrome-profile \
  --no-first-run "https://chatgpt.com"
```

| Visit | Result |
|---|---|
| chatgpt.com | `ERR_TUNNEL_CONNECTION_FAILED` — Wrapbox refused the tunnel |
| gemini.google.com | same — blocked |
| claude.ai | loads normally — your rule approved it |
| google.com | loads normally — catch-all allow |

Every attempt is a signed receipt (`enforcement: "proxy"`). Chrome retries a
blocked site aggressively, so expect dozens of BLOCK receipts for one visit:

```sh
grep '"target":"chatgpt.com' $WRAPBOX_HOME/receipts.jsonl | wc -l
```

Honest limit: this is the browser you launched through the proxy. A browser the
employee opens by clicking its icon is not routed until the proxy is set
system-wide (an MDM-pushed network profile) — that is the production
deployment path, documented in `docs/runtime/WRAPBOXD.md`, not this test.

## 6c. Prove CONTENT inspection — the body, not just the hostname

Steps 5 and 6b govern **where** traffic goes. This step governs **what is inside
it**. With `--inspect` the proxy terminates TLS using a local CA, classifies the
decrypted body, and decides *before a single byte reaches the destination*.

### Create the local CA

```sh
cd ~/Music/wrapbox-prototype/runtime
WRAPBOX_HOME=/tmp/wrapbox-demo/home npx tsx src/cli.ts ca init
```

It prints the certificate path: `/tmp/wrapbox-demo/home/ca/wrapbox-ca.crt`.
For the curl tests below we hand that file to curl with `--cacert`, so **nothing
is added to your system keychain**. (Only if you want the Chrome test do you need
`ca init` followed by `ca install`, which asks for your macOS password — adding a
trusted root should require a human to approve it.)

### Add content rules

```sh
export WRAPBOX_HOME=/tmp/wrapbox-demo/home
source /tmp/wrapbox-demo/env.sh          # brings back $ORG
export CP=http://localhost:4100
export A='X-Admin-Key: wbx-admin-dev'

# Secrets must never leave, wherever they are going.
curl -s -H "$A" -H 'content-type: application/json' -d "{\"org_id\":\"$ORG\",
  \"name\":\"Block secrets in any upload\",\"effect\":\"block\",\"priority\":400,
  \"condition\":{\"field\":\"tool_input.content_kinds\",\"op\":\"contains\",\"value\":\"secret\"}}" \
  $CP/v1/rules >/dev/null

# Financial documents must never leave.
curl -s -H "$A" -H 'content-type: application/json' -d "{\"org_id\":\"$ORG\",
  \"name\":\"Block financial documents\",\"effect\":\"block\",\"priority\":380,
  \"condition\":{\"field\":\"tool_input.content_kinds\",\"op\":\"contains\",\"value\":\"financial\"}}" \
  $CP/v1/rules >/dev/null

# Customer email addresses are reversibly tokenized, not blocked.
curl -s -H "$A" -H 'content-type: application/json' -d "{\"org_id\":\"$ORG\",
  \"name\":\"Tokenize customer emails\",\"effect\":\"constrain\",\"priority\":300,
  \"condition\":{\"field\":\"tool_input.content_kinds\",\"op\":\"contains\",\"value\":\"pii\"},
  \"constraint\":{\"kind\":\"reversible_tokenize\",\"classes\":[\"EMAIL\"]}}" \
  $CP/v1/rules >/dev/null

cd ~/Music/wrapbox-prototype/runtime && npx tsx src/cli.ts pull
```

### Start the daemon with inspection on

Stop the plain daemon from step 5 first — both bind `127.0.0.1:4180`:

```sh
kill $DAEMON_PID 2>/dev/null
```

```sh
cd ~/Music/wrapbox-prototype/runtime
WRAPBOX_HOME=/tmp/wrapbox-demo/home npx tsx src/cli.ts daemon --inspect
```

`--inspect` is what turns on TLS termination. Without it the daemon still runs,
but decides on hostname alone — and it will say so rather than pretend:
`proxy: inspection requested but no CA found — falling back to hostname-level
enforcement`.

Leave it running. In another tab:

```sh
export WRAPBOX_HOME=/tmp/wrapbox-demo/home
export CA=$WRAPBOX_HOME/ca/wrapbox-ca.crt
export PX=http://127.0.0.1:4180
```

### The tests

**1 — Ordinary content is allowed.** Nothing sensitive, nothing to stop.

```sh
curl -s -x $PX --cacert $CA -o /dev/null -w 'HTTP %{http_code}\n' \
  -X POST https://httpbin.org/post -H 'content-type: text/plain' \
  --data 'notes from the quarterly team offsite'
# → HTTP 200
```

**2 — An API key in the body is blocked.** The hostname is fine; the *content* is not.

```sh
curl -s -x $PX --cacert $CA -o /dev/null -w 'HTTP %{http_code}\n' \
  -X POST https://httpbin.org/post -H 'content-type: text/plain' \
  --data 'deploy with AKIAIOSFODNN7EXAMPLE'
# → HTTP 403
```

See why, in Wrapbox's own response headers:

```sh
curl -s -x $PX --cacert $CA -D- -o /dev/null \
  -X POST https://httpbin.org/post -H 'content-type: text/plain' \
  --data 'deploy with AKIAIOSFODNN7EXAMPLE' | grep -i '^x-wrapbox'
# → x-wrapbox-decision: block
# → x-wrapbox-detected: aws_access_key
```

**3 — Renaming the file does not defeat the rule.** The content is the boundary,
not the extension. Upload a secret disguised as a holiday photo:

```sh
echo 'AKIAIOSFODNN7EXAMPLE' > /tmp/wrapbox-demo/secret.txt
curl -s -x $PX --cacert $CA -o /dev/null -w 'HTTP %{http_code}\n' \
  -X POST https://httpbin.org/post \
  -F "file=@/tmp/wrapbox-demo/secret.txt;filename=holiday-photo.png"
# → HTTP 403 — the multipart part was parsed and its bytes classified
```

**4 — The financial detector fires on a real document shape**, not on one keyword.
It needs several independent signals (currency amounts, accounting vocabulary,
invoice structure, fiscal periods) before it will say "financial":

```sh
curl -s -x $PX --cacert $CA -o /dev/null -w 'HTTP %{http_code}\n' \
  -X POST https://httpbin.org/post -H 'content-type: text/plain' \
  --data 'INVOICE #4471. Subtotal: $12,400.00. Amount Due: $14,632.00. Payment Terms: Net 30. Revenue recognised in fiscal year FY2024; EBITDA and gross margin attached.'
# → HTTP 403
```

Whereas ordinary prose that merely mentions money is **not** blocked — a detector
that cried wolf here would get the product uninstalled:

```sh
curl -s -x $PX --cacert $CA -o /dev/null -w 'HTTP %{http_code}\n' \
  -X POST https://httpbin.org/post -H 'content-type: text/plain' \
  --data 'great quarter, revenue is up and the team is thrilled'
# → HTTP 200
```

**5 — Emails are tokenized, not blocked.** The request goes through, but the
destination never receives the real addresses:

```sh
curl -s -x $PX --cacert $CA -o /dev/null -w 'HTTP %{http_code}\n' \
  -X POST https://httpbin.org/post -H 'content-type: text/plain' \
  --data 'contact a@x.com, b@x.com, c@x.com, d@x.com, e@x.com'
# → HTTP 200
```

The proof is in the receipt — it records what was protected (labels and counts
only, never the values):

```sh
grep protected_total $WRAPBOX_HOME/receipts.jsonl | tail -1 | python3 -m json.tool
# → "effect": "constrain", "protected_counts": ["email:5"], "protected_total": 5

```

Note: if you print the response body you will still see the real addresses. That
is the feature working, not a bug — tokenization is **reversible**, so Wrapbox
swaps the tokens back on the way in. Only the destination saw `<WB_EMAIL_…>`.

**6 — A format we cannot read fails closed.** PDF text lives in compressed
content streams; rather than half-read it and guess, the runtime declares PDFs
uninspectable and refuses when a content rule could apply:

```sh
printf '%%PDF-1.7\n' > /tmp/wrapbox-demo/fake.pdf
head -c 400 /dev/urandom >> /tmp/wrapbox-demo/fake.pdf
curl -s -x $PX --cacert $CA -o /dev/null -w 'HTTP %{http_code}\n' \
  -X POST https://httpbin.org/post -H 'content-type: application/pdf' \
  --data-binary @/tmp/wrapbox-demo/fake.pdf
# → HTTP 403 — "cannot inspect pdf content … and a protection could apply"
```

The same is true of an over-size body, a generic archive, and a payload whose
compression refuses to expand safely (a zip bomb). None of them are ever waved
through as "nothing found".

**7 — Ask the runtime what it can actually do.** This is the honest capability
report the control plane uses; it is generated from the real modules, so it can
never claim a detector or parser that is not there:

```sh
WRAPBOX_HOME=/tmp/wrapbox-demo/home npx tsx src/cli.ts capabilities | python3 -m json.tool
```

You'll see the network plane reporting `deployed: true` with its classifiers
(`secret, source_code, pii, credential_file, financial, phi, legal,
confidential`), its parsers (`text, json, csv, yaml, xml, html, multipart, docx,
xlsx` inspectable; `pdf` not), its handlers, and its identity signals —
`identity.device` proven, `identity.user` / `identity.group` **not** proven.

### Why you cannot point these tests at `localhost`

Local destinations are deliberately never inspected — `localhost`, `127.*`,
`::1` and `*.local` are on the no-inspect list, alongside banks, health and
payroll sites. Inspecting a developer's own loopback traffic would break the
machine for no security gain.

So a mock server on `http://localhost:3000` would be **tunnelled straight
through, unclassified** — and you would wrongly conclude enforcement was broken.
If you want a purely local destination that *is* inspected, give it a name that
isn't loopback-shaped, e.g. add `127.0.0.1 mock-ai.test` to `/etc/hosts` and
test against `https://mock-ai.test`. Everything still runs on your machine; it
just isn't *named* localhost.

## 7. See it all in the browser (v2 workspace)

```sh
cd ~/Music/wrapbox-prototype
npm run dev
```

Open http://localhost:5173/ . In the v2 workspace you'll see an
"Connect a Control Plane" onboarding card. Go to **Settings → Control Plane**:

- Server URL: `http://localhost:4100`
- Admin key: `wbx-admin-dev`
- Org id: paste the `$ORG` value from tab B (`echo $ORG`)

Click **Test connection** → green. The Fleet and Evidence pages populate with
your device, the 11 discovered agents, the rules, and every block receipt from
steps 4–6.

## What each test is proving

| Step | What it proves |
|------|----------------|
| 3    | wrapboxd sees every known AI agent on your Mac and reports the inventory to the server. |
| 4    | The macOS kernel itself refuses the read — not a script that could be edited. |
| 5    | One local proxy governs the network for ANY agent by destination — the model-API guard blocks unattributed processes even under permissive policies. |
| 6    | Every decision is a signed receipt in a chain; tampering is named, not silent. |
| 6b   | Browser-based AI (ChatGPT web, Gemini, Claude.ai) is governed by destination, with every attempt recorded. |
| 6c   | The proxy reads the **decrypted body** — secrets, PII, source code, and financial/PHI/legal/confidential documents, including files inside multipart uploads — and blocks, masks or holds it before egress. Renaming a file does not defeat a content rule, and a format that cannot be read safely fails closed instead of being waved through. |
| 7    | Admins see it live in the browser. |

## Clean up

```sh
rm -rf /tmp/wrapbox-demo
# (control-plane and vite tabs: Ctrl-C)
```

## What this build does NOT yet do (honestly)

- **User and group identity.** The daemon proves the **device** (its enrolment
  key) and the workload — not the human at the keyboard. A rule written for
  "employees" therefore applies to all traffic from the device: it is reported
  as DEGRADED, never as enforced. Closing this needs a real IdP
  (Entra/Okta/MDM); the provider interface is already in place.
- **GUI apps launched by double-click** aren't auto-wrapped — needs Apple's
  Endpoint Security entitlement (1–3 month application). The kernel sandbox +
  proxy still work when you launch them from a wrapped terminal.
- **PDF bodies are not read.** Safe, complete PDF text extraction needs a large
  parser dependency we have deliberately not taken into a security daemon. PDFs
  are declared uninspectable and **fail closed** when a content rule could
  apply — they are never quietly allowed.
- **Office files can be read but not rewritten.** DOCX/XLSX are inspected, so
  BLOCK and REVIEW work on them; a CONSTRAIN that would have to mask cells
  *inside* one fails closed to BLOCK rather than forwarding it unmasked.
- **Detect-only data classes.** financial, PHI, legal and confidential are
  detected but not value-maskable, so a CONSTRAIN naming only those fails closed
  to BLOCK. Only PII value types (email, phone, card, SSN, …) can be tokenized.
- **The Gateway plane is a foundation, not live traffic.** Its evaluator and
  handlers (SQL row caps and blocked statements, MCP allow-lists, API
  endpoint/method limits, payment caps) are implemented and tested on the same
  policy engine, but nothing brokers calls to it yet — it honestly reports
  `deployed: false`. Live database/cloud brokers need real vendor credentials.
- **Linux and Windows.**

Everything above is on the roadmap in `docs/runtime/WRAPBOXD.md`. For the
machine-readable version of this list, run `wrapboxd capabilities` — the runtime
reports exactly what it can observe, classify, parse and enforce, and the
compiler refuses to mark a rule ENFORCED beyond it.
