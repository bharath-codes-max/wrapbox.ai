# Network MVP — status

**Milestone reached: 2026-09-23.** The macOS Network Extension plane is
running end-to-end on this Mac. No further Network-plane work is planned
before Endpoint / Gateway / the parked Intent Contract.

## What is proven, as of this build

| Capability | Evidence |
|---|---|
| System extension activated and approved | `systemextensionsctl list` shows `io.wrapbox.WrapboxProxy.extension` `[activated enabled]`, team `377DAPKD9V` |
| Routing enabled (no manual proxy switch) | `WrapboxApp status` reports `proxy config: present, enabled=true, connected`. `networksetup -getsecurewebproxy Wi-Fi` = `Enabled: No` — nothing in system proxy settings |
| Real HTTPS traffic actually goes through Wrapbox | extension counters, from `sendProviderMessage` handler: `routed > 0`, `daemonFailures = 0`, `tokenlessFlows = 0` |
| QUIC / HTTP/3 handled correctly | `droppedQUIC > 0` — UDP/443 flows are claimed by the provider and closed (fail-visible to Safari/Chrome/curl → TCP/443 fallback), not silently exposed |
| Daemon healthy | launchd `io.wrapbox.wrapboxd` `state = running`, node listening on `127.0.0.1:4180`, answering CONNECT |
| `disable` → direct internet | `WrapboxApp disable` clears the manager `isEnabled`, saves, `stopVPNTunnel`. Verified by `networksetup` and by traffic reaching origins without the extension |
| `enable` again | `BrickGuard` preflight, then `saveToPreferences` + `startVPNTunnel`. Routing back on within one call |
| SIP-enabled path | `csrutil status` = enabled throughout. No `systemextensionsctl developer on` was used |

## The build in `/Applications`

- Bundle: `WrapboxApp.app`, ID `io.wrapbox.WrapboxProxy`.
- Embedded extension: `Contents/Library/SystemExtensions/io.wrapbox.WrapboxProxy.extension.systemextension`, package type `SYSX`.
- Signed **Apple Development: Bharath kumar Salla (LFLY3GNY5W)**, team **`377DAPKD9V`** (Wrapbox Inc — not Personal Team).
- Extension entitlements as signed:
  - `com.apple.application-identifier = 377DAPKD9V.io.wrapbox.WrapboxProxy.extension`
  - `com.apple.developer.networking.networkextension = [app-proxy-provider]`
  - `com.apple.security.application-groups = [377DAPKD9V.io.wrapbox.WrapboxProxy]`
- Extension Info.plist:
  - `NEMachServiceName = 377DAPKD9V.io.wrapbox.WrapboxProxy.extension` (prefixed by the App Group above — required for activation)
  - `NEProviderClasses[com.apple.networkextension.app-proxy] = WrapboxProxyExtension.TransparentProxyProvider`
  - `NSSystemExtensionUsageDescription` — required for NE-category system extensions
- Host app entitlements as signed:
  - `com.apple.developer.system-extension.install = true`
  - `com.apple.developer.networking.networkextension = [app-proxy-provider]`
  - `com.apple.security.application-groups = [377DAPKD9V.io.wrapbox.WrapboxProxy]`

## Commands

Run these from anywhere. They do not need `sudo`.

```sh
# What is running, what is routing — changes nothing.
/Applications/WrapboxApp.app/Contents/MacOS/WrapboxApp status

# Turn Wrapbox routing ON (already-installed extension). BrickGuard checks the
# daemon and CA first; if either is missing the call refuses and routes nothing.
/Applications/WrapboxApp.app/Contents/MacOS/WrapboxApp enable

# Turn Wrapbox routing OFF (traffic goes direct again).
/Applications/WrapboxApp.app/Contents/MacOS/WrapboxApp disable
```

Emergency, when a shell is unusable or the daemon misbehaves:

```sh
~/Music/wrapbox-demo/panic.sh
```

`panic.sh` (time-bounded at every step): `WrapboxApp disable` first, then
`launchctl bootout gui/$(id -u)/io.wrapbox.wrapboxd` (a plain `kill` would be
undone by KeepAlive), then clears any user-set proxies and DNS cache, then
probes `apple.com` and asks the extension whether it is involved before
declaring anything.

## What is deliberately NOT done yet

- Endpoint plane / ES loader — waiting on Apple ES request `4586V6276K`. Not a Network-plane blocker.
- Gateway plane — untouched.
- Intent Contract file tests — parked.
- Developer ID distribution (`app-proxy-provider-systemextension`) — a separate Apple request, not needed to build or run locally.

## Critical unfinished Network-plane item

**None.** The MVP is complete for the demo bar. Two items are worth noting
before we grow past it, but neither blocks calling this milestone done:

1. **Provider crash behaviour is undocumented.** Apple has never published what
   `NETransparentProxyProvider` does when the provider dies mid-flow. Field
   report says traffic can blackhole rather than fall through. If we ever ship
   this beyond us, we need a supervised recovery path — `panic.sh` is enough
   for a demo Mac, not for a fleet.
2. **Development-signed activation is per-Mac.** This build activates because
   Xcode's automatic profile lists this device. Any second Mac needs the same
   Wrapbox Inc team, an added device in the portal, and a rebuild — or a
   Developer ID + Network Extension distribution entitlement, which is a
   separate Apple approval we have not requested.
