# Wrapbox macOS Network Extension (transparent proxy)

Replaces the `--protect-network` / `networksetup` system-proxy approach with an
OS-level transparent proxy, so traffic is captured without touching the user's
network settings and apps that ignore the system proxy can no longer escape.

**Nothing here is active.** The extension has never been installed or approved
on this machine. See "Before activation" below for what would change.

## What this is — and deliberately is not

This is a **routing layer only**. It decides which flows to capture and hands
them to the existing daemon over the daemon's existing interface.

```
App (Chrome / Codex / curl)
  │  OS captures the flow
  ▼
TransparentProxyProvider          ← this directory (~350 lines Swift)
  │  CONNECT <host>:443   →  127.0.0.1:4180
  ▼
wrapboxd  (UNCHANGED)             ← detectors, parsers, policy engine,
  │  terminates TLS with the         transforms, receipts, evidence chain
  ▼  Wrapbox CA
Real destination
```

It contains **no** classification, policy evaluation, transformation or receipt
logic, and it never sees plaintext TLS. Replacing how traffic arrives must not
become a reason to fork the enforcement engine into a second language.

`wrapboxd` is already an HTTP proxy that understands `CONNECT host:port` — that
is exactly what the browser sends it today. The extension is simply another
client of that same interface, so no daemon code changes.

## Files

| File | Role |
|---|---|
| `WrapboxProxyExtension/TransparentProxyProvider.swift` | decides per flow: route, bypass (daemon), or drop (QUIC) |
| `WrapboxProxyExtension/FlowRouter.swift` | carries one flow through the daemon; owned by the provider until done |
| `WrapboxProxyExtension/SNISniffer.swift` | hostname from the TLS ClientHello |
| `Shared/FlowPolicy.swift` | the capture rules and per-flow decisions (unit-tested) |
| `Shared/DaemonDialer.swift` | bounded `CONNECT` to the daemon; used by extension and app |
| `Shared/DaemonIdentity.swift` | audit token → "is this the daemon?", cached per pid+version |
| `Shared/ProcessSocketProbe.swift` | "does this process own the 127.0.0.1:4180 listener?" |
| `WrapboxApp/main.swift` | `status` `preflight` `enable` `disable` `remove` `activate` `deactivate` |
| `WrapboxApp/BrickGuard.swift` | the checks `enable` must pass |
| `Tests/run-tests.sh` | all unit suites, against the same sources the targets compile |
| `Tests/QUICProbe` | real HTTP/3 handshake — baseline now, the drill's QUIC check later |

## What gets captured — and what does not

| Traffic | Handling | Why |
|---|---|---|
| TCP/443 from any app | routed to the daemon | the only port the daemon can inspect |
| TCP/443 from the daemon itself | bypassed (`return false`) | loop guard — see below |
| UDP/443 (QUIC / HTTP/3) | **claimed and closed** | cannot be inspected; client falls back to TCP |
| TCP/80, everything else | never delivered | the daemon breaks plaintext through `CONNECT` |
| loopback | never delivered | `NENetworkRule` excludes it by definition |

**Rules first, `return false` last.** Apple DTS advice for transparent proxies is
to "set up the rules so that you're not passed the flow"; returning NO has been
seen to drop flows in edge cases. So port and protocol scoping live in
`FlowPolicy.includedRules()`. `return false` is used only for the daemon's own
egress — nothing a rule can express.

**Port 80 is out of scope in phase 1.** The daemon with `--inspect` terminates TLS
on every `CONNECT` regardless of port, so a plaintext stream dies (measured:
`curl -p` to `http://example.com` → empty reply). Routing port 80 would break all
plain HTTP. Fixing that is a daemon change, deliberately not made here.

**QUIC is real on this Mac.** `Tests/QUICProbe` completes an HTTP/3 handshake to
`cloudflare-quic.com` and `www.google.com` today, with no extension. A TCP-only
capture would never see that traffic.

## The daemon exclusion (loop guard)

The daemon's own outbound connections must not be captured again, or they loop
back into the daemon. The first design exempted a **code-signing identifier** —
unsafe: Homebrew node is ad-hoc signed, and every node program shares the
identity (verified: the daemon and a separate node process both report
`node-5555494433c8…`). That would have exempted Codex and anything under `npx`.

Now: **a flow is the daemon's if its source process currently owns the TCP
listener on `127.0.0.1:4180`.**

- source process — `NEFlowMetaData.sourceAppAuditToken`, documented in the macOS
  27 SDK and recommended by Apple DTS for identifying a transparent-proxy flow.
  It names the immediate socket owner (e.g. WebKit's networking process, not
  Safari), which is the direction needed here.
- listener ownership — public `libproc`, checking only that one process.
- cached per (pid, pidversion) from the token, so a reused PID cannot inherit it.
- any doubt (no token, lookup failure) → **route**, the enforcing direction.

Residual risk, checked in the drill: if the daemon's own egress ever arrived with
no audit token, it would be routed and loop. `status` reports `tokenlessFlows`.

## Failure behaviour

**Daemon down while routing is on.** The loopback hop to the daemon is bounded:
a refused connection (which `NWConnection` reports as `.waiting`, never
`.failed`) fails in ~0.01s, a silent daemon at 5s. The flow is closed; nothing
reaches the destination. Web traffic is refused until the daemon is back, then
recovers with no extension restart. Nothing restarts the daemon yet — it needs
a launchd `KeepAlive` job.

**Extension crashes — NOT documented by Apple.** No Apple document says what
happens to matched flows while a transparent-proxy provider is down. The one
field report matching this architecture (daemon + app + extension) saw traffic
**blackholed**, not bypassed. Assume the worst: the kill switch below must not
depend on the extension or the daemon being healthy.

## Turning it on — two separate steps

```
WrapboxApp activate    install the system extension           — routes NOTHING
WrapboxApp enable      create + enable the proxy configuration — captures TCP/443
```

`enable` runs a **brick guard** first and refuses unless all three hold. It does
not re-implement policy in Swift — it asks the one engine, empirically:

1. the daemon answers `CONNECT` on `127.0.0.1:4180`;
2. it allows an ordinary host (`example.com`) at the CONNECT stage;
3. a real HTTPS request through it succeeds under **system trust**.

Check 3 is stronger than the `--protect-network` guard: it catches an untrusted
Wrapbox CA, which would break every inspected site once routing starts.

`WrapboxApp preflight` runs the same checks and changes nothing.

## Rollback — fastest first

None of these needs the daemon to be running or networksetup to be touched.

| Level | Command / action | Effect |
|---|---|---|
| 0 | `WrapboxApp disable` | routing off, extension stays installed. Uses only NE preferences — no daemon, no network |
| 0 (GUI) | System Settings → Network → *VPN & Filters / Filters & Proxies* → turn Wrapbox off | same (exact label confirmed at first enable) |
| 1 | System Settings → General → Login Items & Extensions → Network Extensions → off | extension disabled |
| 2 | `WrapboxApp remove` then `WrapboxApp deactivate` | configuration deleted, extension uninstalled |
| 2 (GUI) | drag `WrapboxApp.app` from /Applications to the Trash | macOS removes the extension |
| 3 | Safe Mode boot, delete the app | third-party extensions do not load in Safe Mode |

Not used: `systemextensionsctl uninstall` / `reset`. The man page documents no
preconditions for `uninstall`, and `reset` removes every vendor's extensions.

### `panic.sh` must change before `enable` — proposed, NOT applied

Today it kills the daemon (with the extension routing, that refuses the web),
clears system-proxy settings the extension does not use, then its own test
`curl` is captured too and it reports "Wrapbox is no longer involved" — untrue.
Proposed first step:

```sh
# 0. If the Wrapbox Network Extension is routing, turn that off FIRST.
APPBIN=/Applications/WrapboxApp.app/Contents/MacOS/WrapboxApp
if [ -x "$APPBIN" ]; then "$APPBIN" disable && echo "  · network extension routing: OFF"; fi
```

and the closing message should check `WrapboxApp status` before claiming Wrapbox
is not involved.

## Drill — the first thing after `enable`

Nothing is relied on until the kill switch is proven:

1. `WrapboxApp enable` → `status` shows `connected`.
2. `Tests/QUICProbe cloudflare-quic.com` → must print **H3 BLOCKED** (was
   REACHABLE before enable).
3. Chrome DevTools → Protocol column on `cloudflare-quic.com` shows `h2`, not
   `h3`; a Wrapbox receipt exists for it.
4. `curl https://httpbin.org/get` (no `-x`) → HTTP 200 → proves the daemon's own
   egress is bypassed (not looped, not dropped); `status` shows
   `bypassedDaemon > 0`, `tokenlessFlows = 0`.
5. **Daemon-crash test:** stop the daemon → new HTTPS must fail within seconds,
   not hang → restart it → HTTPS recovers without touching the extension.
6. **Kill-switch test, with the daemon still stopped:** `WrapboxApp disable` →
   HTTPS works again, directly.
7. **Extension-crash test:** kill the extension process → record whether matched
   traffic is blackholed or bypassed and how long relaunch takes. This is the
   undocumented behaviour above; the drill makes it measured, not assumed.

## Signing, verified against the real portal (2026-09-23)

Team **Wrapbox Inc `377DAPKD9V`**, certificate `Apple Development: Bharath kumar
Salla` (OU=377DAPKD9V, O=Wrapbox Inc — the Wrapbox team, not a Personal Team).

**The Network Extensions capability IS enabled on the App ID.** Decoding the
generated profile for `io.wrapbox.WrapboxProxy.extension` shows it grants:

```
app-proxy-provider, content-filter-provider, packet-tunnel-provider,
dns-proxy, dns-settings, relay, url-filter-provider, hotspot-provider
```

Note what is ABSENT: none of the `-systemextension` suffixed values. So:

| | Entitlement value | Needs |
|---|---|---|
| Development (now) | `app-proxy-provider` | nothing — already granted |
| Developer ID distribution | `app-proxy-provider-systemextension` | Network Extension **distribution** authorization from Apple |

That distribution request is a SECOND, separate Apple request — unrelated to the
Endpoint Security one (`4586V6276K`). It is not needed to build or test locally.

The app's profile grants `com.apple.developer.system-extension.install = true`.

## Build

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodebuild build -project macos/WrapboxProxy.xcodeproj -scheme WrapboxApp \
  -configuration Debug CODE_SIGNING_ALLOWED=NO
```

Signed builds need a development certificate for the **Wrapbox Inc** team (see
below).

## Before activation — status

Nothing has been installed or enabled. Signing is done (Wrapbox Inc,
`377DAPKD9V`; `NEMachServiceName` resolves to
`377DAPKD9V.io.wrapbox.WrapboxProxy.extension`).

| Step | System change | Routes traffic? |
|---|---|---|
| `activate` | installs the extension; approval in Login Items & Extensions | **no** |
| `enable` | adds + enables a proxy configuration; approval prompt | **yes** — TCP/443 via the daemon, UDP/443 dropped |

Still to do before `enable`, each needing your go-ahead:

- update `panic.sh` (proposal above)
- a launchd `KeepAlive` job for the daemon, so a crash is not permanent
- copy `WrapboxApp.app` to `/Applications` (required for `activate`)
- start the daemon with `--inspect` and **without** `--protect-network`

SIP stays enabled throughout. The `systemextensionsctl developer on` route is
deliberately not used — it requires disabling SIP, and proper signing makes it
unnecessary.

## Relationship to Endpoint Security

Unrelated. Endpoint Security (request `4586V6276K`) governs local file and
process enforcement. This extension governs network flows only, and needs none
of it.
