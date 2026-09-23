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
| `WrapboxProxyExtension/TransparentProxyProvider.swift` | which flows to capture |
| `WrapboxProxyExtension/FlowRouter.swift` | CONNECT to the daemon, pump bytes |
| `WrapboxProxyExtension/SNISniffer.swift` | hostname from the TLS ClientHello |
| `WrapboxApp/main.swift` | container app; activates only on explicit argument |

## Three problems this had to solve

**Hostname, not IP.** A transparent proxy is handed a flow the app already
resolved, so the destination is an IP. `CONNECT 104.18.2.1:443` would break every
host rule in the contract and make the daemon mint a certificate for an IP.
`NEAppProxyFlow.remoteHostname` is populated only for connect-by-name APIs
(NSURLSession, Network.framework) — Chrome, curl and node do their own DNS — so
the fallback reads the SNI out of the ClientHello. Verified against a real
OpenSSL ClientHello, and against truncated, malformed and random input.

**Loop prevention.** Two halves. The extension→daemon hop on loopback is
excluded automatically: per `NENetworkRule.h`, a rule with nil remote and local
networks matches all traffic *"except for loopback traffic"*. The daemon's own
**egress** is not covered by that, so it is excluded by code-signing identifier
via `WBXExcludedSigningIdentifiers` in the extension's `Info.plist`.

> Homebrew's node is ad-hoc signed, so its identifier changes on upgrade.
> Re-check before activation:
> `codesign -dv "$(readlink -f "$(command -v node)")"`
> A shipped, signed `wrapboxd` gets a stable identifier and this stops being fragile.

**QUIC.** With a system proxy configured, Chrome disables QUIC. A *transparent*
proxy is invisible, so Chrome would use HTTP/3 over UDP/443, which a TCP proxy
never sees — a silent enforcement hole. Phase 1 captures TCP only; UDP/443 must
be captured and dropped to force TCP fallback before this is relied on.

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

## Before activation — what would actually change

Activation is a real system change and has **not** been done. It would:

1. install a system extension into `/Library/SystemExtensions`
2. prompt for approval in **System Settings → General → Login Items & Extensions**
3. once approved, route **every app's** TCP/80/443 through `127.0.0.1:4180`

Prerequisites still outstanding:

- a development certificate for the Wrapbox Inc team (none on this Mac)
- `NEMachServiceName` must resolve to `<TeamID>.io.wrapbox.WrapboxProxy.extension`;
  it currently builds without the prefix because no team is set
- the app must be run from `/Applications`
- the daemon must be listening on `127.0.0.1:4180`, or every flow fails closed
- the `WBXExcludedSigningIdentifiers` entry must match the running daemon

SIP stays enabled throughout. The `systemextensionsctl developer on` route is
deliberately not used — it requires disabling SIP, which is unnecessary once the
extension is properly signed.

## Relationship to Endpoint Security

Unrelated. Endpoint Security (request `4586V6276K`) governs local file and
process enforcement. This extension governs network flows only, and needs none
of it.
