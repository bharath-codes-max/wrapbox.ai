# wrapboxd — security documentation (macOS build)

This document describes the wrapboxd runtime **as currently built** in `runtime/` against
`SPEC-wire.md` / `SPEC-runtime.md` / `SPEC-control-plane.md`. Where the production deployment
differs from this prototype, the difference is stated in-line and labeled. Every enforcement claim
below was verified by experiment on macOS 26.3 (build 25D125, Darwin 25.3.0) or against the
vendor's current official documentation; nothing is asserted from assumption.

---

## 1. What wrapboxd is

wrapboxd is a per-device runtime that governs what AI coding agents (Claude Code today; Cursor and
Codex CLI use the same contract shape) are allowed to do on an employee's machine. It enforces
policy at two independent layers: a kernel sandbox (macOS Seatbelt) around the agent process, and a
pre-action hook inside the agent that checks every tool call against the organization's rules
before it executes. Decisions are made locally from a cached ruleset pulled from the Wrapbox
Control Plane — the network is never on the decision path. Every decision, kernel denial, and
detected tampering event becomes a signed receipt in a per-device hash chain that the server can
verify independently. The design goal, in one sentence: **any failure or removal of wrapboxd must
leave the agent less capable, never more — and must be visible.**

---

## 2. The two enforcement layers

### 2.1 Kernel floor — Seatbelt (`wrapboxd run`)

`wrapboxd run -- <agent command>` launches the agent under `sandbox-exec` with a generated
Seatbelt profile: allow-by-default, with targeted kernel denies for secret-file patterns
(`.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `~/.ssh`, `~/.aws`), extra denies
derived from cached BLOCK rules with path conditions, and a network posture of `on`, `off`, or
loopback-port-only.

**What the floor provably guarantees** (each item verified by experiment on this exact macOS
version):

- Kernel-level denial of reads of the denied paths — `cat`, `cp`, `python3 open()`, and Node
  `fs.readFileSync` all return `EPERM`; the agent's cooperation is not involved.
- Enforcement on the **resolved** path: a symlink with an innocent name pointing at `.env` is
  still blocked. Hardlink creation to a protected file is also blocked.
- Inheritance into **all child processes**, through multiple exec levels (`sh → bash → python3`,
  Node `child_process.execSync`). Sandbox state is kernel-side and cannot be dropped by re-exec.
- Write protection of designated directories: file creation and deletion both blocked.
- Network kill (`deny network*`) blocks `curl` at both DNS and direct-IP connect; the
  loopback-port shape (`deny network-outbound` + `allow (remote ip "localhost:PORT")`) was
  functionally proven against a live listener — localhost succeeds, `example.com` and `1.1.1.1`
  fail.
- Denials are observable **without sudo** in the unified log; wrapboxd tails them and converts
  denials for the wrapped session into `violation` receipts.

**What the floor does not do.** SBPL network filters accept only `localhost` or `*` as a host —
the parser rejects arbitrary IPs, hostnames, and domains outright. Seatbelt therefore cannot do
domain-level egress; that requires pinning the agent to a local filtering proxy (roadmap, §8).
Path deny rules match paths, not content: a secret copied to an unlisted path before wrapping is
not covered. And `sandbox-exec` is marked DEPRECATED in its man page while remaining fully
functional and warning-free; it is the same kernel engine Bazel's `darwin-sandbox` officially
uses and Chromium relies on. Our posture: deprecated CLI, stable kernel engine, tracked as a
platform risk.

**See it work:**

```sh
# A profile that denies .env reads, then attempt the read under it:
cat > /tmp/wb-demo.sb <<'EOF'
(version 1)
(allow default)
(deny file-read* (regex #"(^|/)\.env$"))
EOF
echo 'FAKE_KEY=test123' > /tmp/wb-demo.env.dir/.env 2>/dev/null || { mkdir -p /tmp/wb-demo.env.dir; echo 'FAKE_KEY=test123' > /tmp/wb-demo.env.dir/.env; }
sandbox-exec -f /tmp/wb-demo.sb /bin/cat /tmp/wb-demo.env.dir/.env   # -> Operation not permitted, exit 1
/bin/cat /tmp/wb-demo.env.dir/.env                                   # -> succeeds outside the sandbox

# The kernel's own record of the denial (no sudo; /usr/bin/log — plain `log` is a zsh builtin):
/usr/bin/log show --last 2m --style compact \
  --predicate 'sender == "Sandbox" AND eventMessage CONTAINS "deny"'
# -> kernel[0:…] (Sandbox) Sandbox: cat(PID) deny(1) file-read-data /tmp/wb-demo.env.dir/.env
```

### 2.2 Policy ceiling — agent hooks (`wrapboxd check`)

`wrapboxd protect claude-code` installs PreToolUse hooks into `~/.claude/settings.json`
(matchers: `Bash`, `Edit|Write|NotebookEdit`, `Read`, `WebFetch|WebSearch`, `mcp__.*`). Each hook
runs `wrapboxd check`, which reads the tool call from stdin, evaluates it against the cached
signed ruleset with the **same** `evaluate()` engine the Control Plane uses (extracted into
`@wrapbox/policy-core` — one matcher everywhere, per the engineering standard), and answers via
the documented Claude Code contract: stdout
`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"|"deny"|"ask","permissionDecisionReason":"…"}}`.
REVIEW rules map to `"ask"`, which routes the call into Claude Code's own permission prompt.
Denial reasons are surfaced to the model, so the agent adapts instead of thrashing.

**The one fact that shapes this design:** Claude Code's own hook timeout **fails open** — the
vendor docs state a timed-out PreToolUse hook does not block the tool call. Fail-closed therefore
lives inside `wrapboxd check` itself: it never touches the network, decides from the local cache
in milliseconds, guards stdin with a 2-second timeout, and on **any** internal error exits 2 —
which always blocks, regardless of JSON output. The `timeout: 10` configured on the hook is a
backstop against shim bugs, never the control.

**What the ceiling guarantees:** per-action policy on every hooked tool call, with
machine-readable reasons, plus a decision receipt for every call. **What it does not guarantee:**
the ceiling is userspace string matching before execution — it is a policy and UX layer, not the
anti-TOCTOU layer (only the kernel resists TOCTOU), and a user who owns `~/.claude/settings.json`
can edit it (see B2 in §5 for exactly what happens then).

**See it work** (from `runtime/`, on an enrolled device with a rule blocking `.env` reads):

```sh
echo '{"hook_event_name":"PreToolUse","tool_name":"Read",
      "tool_input":{"file_path":"/Users/me/work/api/.env"},"cwd":"/Users/me/work/api"}' \
  | wrapboxd check --agent claude-code
# -> {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
#     "permissionDecisionReason":"Wrapbox: Block .env reads"}}
```

*(Dev invocation while unpackaged: `npx tsx src/cli.ts check …` from `runtime/`.)*

**Layer independence.** Killing the daemon does not lift Seatbelt on an already-wrapped process
(the profile is kernel state fixed at launch), and stripping the wrapper does not remove the
hooks (they live in the agent's own config). Every receipt records which layers actually covered
the action — `enforcement: hook | seatbelt | both | unwrapped | hook-degraded` — so the Evidence
view can never imply kernel coverage that was not present.

---

## 3. Decision flow and fail-closed semantics

```
agent tool call
   └─ PreToolUse hook ─→ wrapboxd check
         ├─ load ~/.wrapbox/cache/rules.json  (no network, ever)
         ├─ applyProjectFilter + evaluate()   (priority DESC, first match wins,
         │                                     no match ⇒ BLOCK fail-closed)
         ├─ write signed receipt (chained, spooled locally)
         └─ stdout decision / exit 2 on any error (exit 2 always blocks)
```

Rules are pulled from the Control Plane every 60 s (`/v1/rules/pull`), cached with their
`pulled_at` timestamp. The evaluator is the identical code path the Control Plane simulator,
tester, and `/v1/check` use.

*Prototype vs production, stated plainly:* in this build the cached ruleset's integrity rests on
file permissions (0600) and the pinned HTTPS origin it was pulled from; per-bundle signatures
with monotonic version high-water marks are the production hardening, documented not implemented.

### Fail-closed table (concrete numbers, as built)

| Condition | Behavior | Number |
|---|---|---|
| No matching rule | BLOCK — "No matching rule — blocked by default (fail closed)" | — |
| Not enrolled / cache missing | Deny every hooked call: "no policy on this device (fail closed)" | — |
| Cache stale | Read-only tools (Read/Grep/Glob) on paths **inside the session cwd** allowed, receipt stamped `enforcement:"hook-degraded"`, `degraded:true`; everything else denied "policy expired — reconnect to refresh (fail closed)" | staleness threshold **24 h** |
| Stdin malformed or slow | Treated as invalid → deny | **2 s** stdin timeout |
| Any internal error in `check` | exit 2 → hard block (blocks even if stdout said allow) | — |
| Agent hook timeout | Would fail **open** (vendor behavior) — never reached because `check` self-enforces above | configured **10 s**, backstop only |
| Rules pull | background refresh | every **60 s** |
| Heartbeat | `{daemon_version, ruleset_pulled_at, chain_head_seq}` | every **30 s** |
| Missed heartbeats → offline flag | server-side detection target: 3 missed beats | **90 s** *(prototype stores heartbeat fields; the alert rendering is Control Plane roadmap)* |
| Evidence drain | batch ≤ 100 receipts to `/v1/evidence` | every **10 s** |
| Hook-config tamper scan | sha256 of `~/.claude/settings.json` vs recorded hash; rewrite + tamper receipt on drift | every **5 s** |
| Server API calls (never on the decision path) | AbortSignal timeout | **5 s** |

The single deliberate fail-open carve-out is the stale-cache in-workspace-read allowance, and it
is stated here verbatim because a pure deny-everything failure mode teaches users to bypass the
product. Production numbers beyond this build (a 72 h degraded grace window with asymmetric decay
— BLOCKs enforced forever, sensitive ALLOWs decaying to DENY; a 120 s synchronous REVIEW wait
backed by server-side permits) are specified in the fail-mode spec and labeled roadmap; in this
build REVIEW resolves through the agent's own `ask` prompt instead.

---

## 4. Evidence chain

Every decision, kernel violation, and tamper event is a **receipt v1**:

```json
{
  "v": 1, "id": "<nanoid>", "seq": 42, "ts": "2026-09-14T18:22:31.114Z",
  "device_id": "…", "key_id": "dk_<16 hex of sha256(pubkey PEM)>",
  "agent": "claude-code", "session": "…",
  "tool_name": "Read", "tool_input_sha256": "…", "target": "/path/or/command",
  "effect": "allow" | "block" | "review" | "tamper" | "violation",
  "reason": "Block .env reads", "rule_id": "…", "ruleset_pulled_at": "…",
  "enforcement": "hook" | "seatbelt" | "both" | "unwrapped" | "hook-degraded",
  "degraded": false,
  "prev": "<sha256 of previous receipt's canonical bytes>",
  "sig": "<base64 ECDSA P-256/SHA-256, ieee-p1363>"
}
```

- **Canonicalization:** UTF-8 of a deterministic stringify (object keys sorted lexicographically
  at every level, no whitespace) over the receipt minus `sig`, implemented identically on device
  and server from one shared definition. *(RFC 8785 JCS with golden test vectors is the
  production formalization of the same idea.)*
- **Signing:** ECDSA P-256 / SHA-256, fixed 64-byte `ieee-p1363` signatures. The device keypair
  is generated at enrollment; the public key (SPKI PEM) is registered with — and pinned by — the
  server; the private key is stored PKCS#8 PEM, mode 0600.
- **Chaining:** `seq` starts at 1 and is strictly +1 per receipt, persisted across restarts
  (atomic tmp-write + rename). `prev` is the SHA-256 of the previous receipt's canonical bytes.
  Genesis: `prev = sha256(device_id + ":" + key_id)`. *(Production adds a server-minted
  enrollment nonce to the genesis anchor so the device does not choose its own chain root.)*
- **Enrollment:** single-use `wbxe_` tokens minted by an admin (stored server-side as a hash
  only, TTL ≤ 168 h, burned atomically on use); the device submits its public key with the token
  and receives its device id and API key. Tokenless and reused-token enrollments are rejected.
- **Transport:** receipts spool locally in an append-only file and drain in batches of ≤ 100 to
  `POST /v1/evidence`, which verifies each signature against the enrolled key before accepting
  (`bad_signature` / `device_mismatch` rejections; idempotent on receipt id). Every 30 s
  heartbeat carries `chain_head_seq`.

### What each tamper type looks like server-side

`GET /v1/evidence/verify?org_id=…&device_id=…` (admin, org-scoped) re-walks the full stored chain —
signatures, `prev` linkage, seq continuity — and returns `{chain_ok, verified_through_seq,
breaks:[{seq, kind, detail}]}`. This is the endpoint a customer's auditor uses independently of our
UI. `GET /v1/receipts?org_id=…` lists the stored receipts themselves (with `verified` per row).

| Tamper | Server observation | Reported as |
|---|---|---|
| Receipts deleted before sync | seq jumps (e.g. 42 → 50) | `seq_gap` with the span |
| Receipt edited in place | receipt N+1's `prev` no longer matches sha256 of N's canonical bytes | `chain_broken` at seq N+1 |
| Forged receipt (no device key) | signature fails against the pinned public key | `bad_signature`, rejected at ingest |
| Receipt replayed to another device's chain | `device_id` ≠ authenticated device | `device_mismatch`, rejected at ingest |
| Chain truncated / local state reset | heartbeat `chain_head_seq` below the server's stored head | visible in device row *(prototype stores it; the automatic alarm is roadmap)* |

The honest word is tamper-**evident**, never tamper-proof. Stated residual: the machine's owner
editing the spool **before first sync** and re-signing with the file-based key produces a clean
forged chain; Secure Enclave keys (§8) close the re-sign step, and nothing closes "evidence
generation suppressed entirely" except the ES-entitled process floor plus fleet alerting on
silence.

---

## 5. Threat matrix

Adversary classes: **A1** careless employee, **A2** willful employee (admin on own laptop),
**A3** compromised / prompt-injected agent, **A4** malicious insider, **A5** local attacker with
user-level (not root) code execution.

Verdicts: **P** = prevented, **D** = detected (tamper-evident, evidenced), **–** = neither.
The "this build" column is the truth of the prototype as specced; hardening deltas are named.

| # | Bypass | Used by | Verdict (this build) | What actually happens |
|---|---|---|---|---|
| B1 | Run the agent outside the wrapper (plain `claude`, no `wrapboxd run`) | A1 A2 A3 | Partial P / **D** | Hooks live in the agent's own settings, so the policy ceiling survives; the kernel floor is absent. Receipts from such sessions carry `enforcement:"hook"`, never `"both"` — the downgrade is visible, not silent. Guaranteed visibility of *every* process launch requires the ES entitlement (restricted, Apple application, months of lead time) — roadmap. |
| B2 | Edit or delete the agent hook config; `claude --settings '{"disableAllHooks":true}'` | A2 A3 A4 | No / **D** | The daemon compares the settings-file hash every 5 s, rewrites its entries, and emits an `effect:"tamper"` receipt. Claude Code's file watcher re-arms restored hooks mid-session (documented vendor behavior). The `disableAllHooks` CLI flag defeats user-level hooks with no file edit to observe. Closing this class requires delivery via Claude Code **managed policy settings** (`/Library/Application Support/ClaudeCode/managed-settings.json`, root-owned, with `allowManagedHooksOnly:true` — user settings cannot override it): documented, not written by this build. |
| B3 | Tamper with wrapboxd's own state (`~/.wrapbox`), steal the device API key, repoint the server | A2 A4 **A5** | No (as built) / weak D | This build keeps state under `~/.wrapbox` (0600, but user-owned), so any process running as the user can read the API key or edit the cache. One mitigation is implemented: the server URL is pinned in config at enrollment and the `WRAPBOX_SERVER` env override is **ignored after enrollment**. The production layout — root LaunchDaemon, all state in `/Library/Application Support/Wrapbox` (root:wheel), no env overrides — upgrades this to **P** against A5 and is documented, not implemented. |
| B4 | Kill the daemon | A2 A4 | Non-admin: P (production root daemon) · Admin: No / **D** | Killing wrapboxd does not lift Seatbelt on already-wrapped processes (kernel state at launch). Hooks fail closed without a fresh cache once it goes stale — a dead daemon trends the agent toward read-only, not toward freedom. Heartbeats stop; the server-side flag target is 90 s. Even MDM's Service Management payload leaves `launchctl` available to admins (Apple's own deployment guidance) — we never claim an unkillable daemon. |
| B5 | Second agent copy (`HOME=/tmp claude`, portable install, unknown script calling a model API) | A2 A3 A4 | No / weak D | Same-HOME copies still read `~/.claude/settings.json` and are hooked. `HOME` redirection or foreign agents escape user-level hooks, and no process visibility exists to see the launch. Answers: managed-settings path (machine-scoped, $HOME-independent), then the ES process floor, then network-layer control for unknown agents — all roadmap. |
| B6 | Relaunch the wrapped agent unwrapped mid-session | A2 A4 | No / **D** | The `enforcement` provenance field downgrades from `both` to `hook` on every subsequent receipt; Evidence shows the downgrade rather than blending it. |
| B7 | Symlink / rename / TOCTOU tricks against path rules | A3 A4 | Floor: mostly **P** · Ceiling: No / **D** | Verified: Seatbelt enforces on the resolved path at syscall time — symlink indirection fails in the kernel, and hardlink creation to a protected file is itself denied. Residuals: pre-existing aliases and second paths to the same content. The hook layer is pre-execution string matching and is trivially TOCTOU-able; only the kernel layer resists TOCTOU, and the docs say so. |
| B8 | Exfil via allowed channels (DNS tunneling, secrets inside a permitted `git push`, allowed domains) | A3 A4 | **–** | Seatbelt network filtering is loopback/port-granular only — it cannot see hostnames, and anything with resolver access can tunnel. Content inside genuinely allowed channels passes. Domain-level egress requires the local filtering proxy pinned by the loopback-only profile (§8); content inspection is DLP, a different product. Receipts provide forensics, not prevention. |
| B9 | Delete local receipts before sync | A2 A4 | No / **D** | Hash chain + strictly monotonic seq + `chain_head_seq` in heartbeats: deletion produces a named `seq_gap` on verify. Deletion cannot be silent; it can only be visible. |
| B10 | Forge receipts | A4 A5 | A5 (non-root): **P** · owner/root: No / partial D | Forgery without the device key fails server signature verification at ingest. The file-based key is readable by its owner in this build (user-owned `~/.wrapbox`; root-owned 0600 in production, where only root crosses this line). SEP keys (roadmap) prevent extraction and cloning — but not on-device *use* of the key by root through the daemon; we document exactly that much. |
| B11 | Replay a stale ruleset after policy tightens; clock rollback | A4 | Partial / weak D | The cache carries `pulled_at`; staleness > 24 h collapses the agent to in-workspace reads only, so holding an old cache buys at most a day of the old ALLOWs plus read-only thereafter. Signed bundles, a persisted monotonic version high-water mark, monotonic-clock TTL accounting, and a ±300 s skew alarm are the production spec — documented, not implemented. |
| B12 | Downgrade wrapboxd to an older, weaker build | A2 A4 | No / **D** (partial) | Heartbeats carry `daemon_version` and the server stores it. The production control — a server-enforced minimum-version floor answering HTTP 426, which the daemon treats as fail-closed — is documented, not implemented. |

**The honest per-adversary summary.** Against a prompt-injected agent (A3) the story is
strongest: it cannot out-run the kernel floor, self-unhooking is healed and receipted, and denials
carry reasons the model can read. Against a willful admin (A2/A4) the claim is deterrence plus
evidence, never physical prevention: every bypass path either fails or trips a named, signed
record — the same honest posture the EDR industry holds (a 2025 SentinelOne anti-tamper bypass is
the cautionary tale for claiming more). Against user-level malware (A5), the production layout
defeats credential theft and forgery outright; the prototype layout does not, and says so.

---

## 6. What this build CAN and CANNOT claim

Every dashboard, doc, and sales sentence must trace to a CAN line. CANNOT lines appear in the
product only as labeled roadmap.

**CAN claim:**

1. **Kernel-enforced file and network denies for wrapped agent processes**, including every child
   process they spawn, surviving symlinks and hardlinks, with no dependence on the agent's
   cooperation — verified by experiment on macOS 26.3. (Published caveat: Seatbelt/`sandbox-exec`
   is deprecated-but-functional Apple tooling, the same engine Bazel and Chromium rely on; we
   track the platform risk.)
2. **Per-action policy on every hooked tool call**, evaluated before execution, with denial
   reasons the model can read.
3. **Fail-closed implemented in our own shim.** The decision path does no network I/O; on missing
   policy, stale policy (beyond the stated read-only-in-workspace carve-out), bad input, or any
   internal error, the shim itself emits an explicit deny or exits 2. We do not depend on the
   agent's hook timeout, which demonstrably fails open.
4. **A signed, hash-chained, tamper-EVIDENT audit trail** — ECDSA P-256 receipts, per-device
   chain, server-side signature verification at ingest and full chain re-verification on demand
   via an auditor-usable endpoint. We say tamper-evident. We never say tamper-proof.
5. **Self-healing agent hook configuration with tamper receipts** — drift detected within 5 s,
   rewritten, recorded as evidence.
6. **Offline enforcement from the cached ruleset** with a 24 h freshness bound and fail-closed
   decay to read-only-in-workspace.
7. **One policy engine everywhere** — the rule evaluated on the laptop is byte-for-byte the rule
   the Control Plane simulator, YAML view, and tester evaluate (`@wrapbox/policy-core`).
8. **Enforcement provenance on every receipt** — hooked-but-unwrapped sessions are visibly
   flagged, never blended with kernel-covered ones.
9. **Token-gated device enrollment** — single-use, hashed-at-rest, expiring enroll tokens; the
   device's public key is pinned at enrollment; the server URL is pinned at enrollment and env
   overrides are ignored thereafter.

**CANNOT claim (and must not imply):**

1. **A fleet-wide process floor.** An agent launched outside the wrapper with hooks stripped, or
   an unknown script calling a model API, is invisible to this build. Requires the restricted
   Endpoint Security entitlement — roadmap.
2. **Domain-level egress control.** Seatbelt cannot filter hostnames (parser-verified). Requires
   the local filtering proxy / Network Extension — roadmap.
3. **An unkillable daemon.** A local admin can stop wrapboxd; even MDM leaves `launchctl` open to
   admins. The claim is: killing it restricts the agent, survives on already-wrapped processes,
   and becomes visible within one heartbeat window.
4. **Protection against the machine's owner (or root).** In this build, state lives under
   `~/.wrapbox` with a `WRAPBOX_HOME` override for testing and 0600 permissions — the owner can
   read the device key and API key. The root-LaunchDaemon / `/Library` layout and
   managed-settings hook delivery are **production deployment, documented not implemented**.
   Until SEP keys ship we never print "non-exportable".
5. **Signed policy bundles with replay protection.** The cache is trusted on file permissions and
   pinned transport in this build; bundle signatures, monotonic version floors, and clock-skew
   defenses are documented spec, not implemented.
6. **Data-loss prevention on allowed channels.** A permitted push or API call can carry secrets
   in its content; DNS tunneling works wherever a resolver is reachable. We are a policy gate,
   not a DLP product; receipts give forensics.
7. **Coverage of VMs, containers, or unmanaged devices.** Out of scope until the network Gateway
   path exists.
8. **Windows and Linux parity.** Roadmap, already labeled as such in the product.
9. **"The agent cannot bypass its hooks."** A willful user can launch with hooks disabled. What
   we claim instead: removal is healed and evidenced, managed-policy delivery closes the
   user-level hole (roadmap), and unhooked/unwrapped activity is flagged, never hidden.

---

## 7. Demo script — what an evaluator runs

Prerequisites: Control Plane running (default `http://localhost:4180`), `runtime/` built or run
via `npx tsx src/cli.ts` from `runtime/`. Enrollment (once): admin mints a token via
`POST /v1/enroll-tokens`, then `wrapboxd enroll --server URL --org ORG --token wbxe_…`, then
`wrapboxd pull`. Confirm state at any point with `wrapboxd status` (enrollment, ruleset age,
chain head, spool depth, enforcement mode).

**1. A policy block, end to end** (rule "Block .env reads" active):

```sh
echo '{"hook_event_name":"PreToolUse","tool_name":"Read",
      "tool_input":{"file_path":"/Users/me/work/api/.env"},"cwd":"/Users/me/work/api"}' \
  | wrapboxd check --agent claude-code
# -> permissionDecision "deny", reason "Wrapbox: Block .env reads"
# A signed block receipt is now in ~/.wrapbox/receipts.jsonl (tail -1 to inspect).
```

**2. A kernel denial** (the floor, independent of the agent):

```sh
cd ~/work/api && wrapboxd run --net off -- sh -c 'cat .env; curl -sS https://example.com'
# cat:  Operation not permitted   (kernel deny, resolved-path, inherited by the child shell)
# curl: could not resolve host    (deny network*)
# wrapboxd's log watcher converts the Sandbox denials into effect:"violation" receipts,
# enforcement:"seatbelt". Raw kernel record, no sudo:
/usr/bin/log show --last 2m --style compact \
  --predicate 'sender == "Sandbox" AND eventMessage CONTAINS "deny"'
```

**3. A tamper receipt** (daemon self-healing):

```sh
wrapboxd protect claude-code      # install hooks, record their hash
wrapboxd daemon &                 # heartbeat 30s, pull 60s, drain 10s, tamper scan 5s
# In another shell, sabotage the hooks:
python3 -c "import json,os; p=os.path.expanduser('~/.claude/settings.json'); \
  d=json.load(open(p)); d['hooks']={}; json.dump(d,open(p,'w'))"
sleep 6 && tail -1 ~/.wrapbox/receipts.jsonl
# -> {"effect":"tamper","reason":"claude-code hooks modified — restored", ...}
# and the hook entries are back in settings.json. Stop the daemon (fg, Ctrl-C) when done.
```

**4. Chain verification, and what a break looks like:**

```sh
wrapboxd verify                   # local: recompute canonical bytes, verify every sig + prev + seq
wrapboxd sync                     # drain the spool to the server
curl -s -H "X-Admin-Key: $ADMIN_KEY" \
  "http://localhost:4180/v1/evidence/verify?org_id=$ORG_ID&device_id=$DEVICE_ID"
# -> {"chain_ok": true, "verified_through_seq": N, "breaks": []}

# Now tamper: flip one character inside any receipt line in ~/.wrapbox/receipts.jsonl, re-run:
wrapboxd verify
# -> reports the first break: bad_signature at that seq (and chain_broken at the next).
# Delete a middle line instead and the server-side verify reports a seq_gap naming the span.
```

---

## 8. Roadmap, with the reason each item exists

| Item | Why | Status |
|---|---|---|
| **Endpoint Security entitlement** (`com.apple.developer.endpoint-security.client`) | The only way to see and gate *every* process exec fleet-wide (AUTH_EXEC), closing B1/B5 (agents launched outside the wrapper, unknown binaries). Restricted entitlement, granted case-by-case via Apple's system-extension request form; multi-month lead times are reported — file the request now, ship without it. | Application-gated roadmap |
| **Local filtering proxy → Network Extension egress** | Seatbelt's parser only accepts `localhost`/`*` hosts, so domain policy is impossible in-profile. The proven shape: profile pins the agent to loopback-port-only; a wrapboxd-owned HTTP CONNECT/SOCKS5 proxy does hostname allow/deny with resolved-address checks (drop loopback, link-local, metadata, host-interface, RFC1918 targets) — the same design as Anthropic's sandbox-runtime. Closes domain-level B8. | Roadmap; profile shape already verified |
| **Root LaunchDaemon + `/Library` state + managed-settings hook delivery** | Moves every trust root (device key, API key, cache, chain head, hook config) out of the user's reach: upgrades B3 to prevented against user-level attackers and closes the `disableAllHooks` hole in B2 via `allowManagedHooksOnly`. | Production deployment, documented not implemented |
| **Signed rulesets, version floors, 426 fail-closed** | Makes cache replay (B11) and daemon downgrade (B12) cryptographically and protocol-level dead ends instead of staleness-bounded ones. | Documented spec |
| **Secure Enclave device keys** | Removes key extraction and cloning even by root, closing the B10 re-sign residual. Honest limit retained: root can still *use* the key through the daemon; SEP stops extraction, not on-device misuse. Requires a native Security.framework helper (Node crypto cannot reach the SEP). | Roadmap |
| **MDM delivery** | Auto-enrollment, locked login items (macOS 13+ Service Management payload), managed-settings distribution — turns per-machine setup into fleet posture. Does not make the daemon unkillable (admins keep `launchctl`), and we will keep saying so. | Roadmap |
| **Linux / Windows runtimes** | Same two-layer model with platform floors (bubblewrap + seccomp on Linux, per sandbox-runtime's pattern; Windows is already labeled roadmap across the product). One `check` contract already spans Claude Code, Cursor, and Codex CLI, so the ceiling ports first. | Roadmap, labeled in-product |
