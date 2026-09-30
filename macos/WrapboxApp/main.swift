import Foundation
import NetworkExtension
import SystemExtensions

/// Wrapbox Network Extension — container app.
///
/// Turning Wrapbox's network capture on is TWO independent steps, and they are
/// deliberately separate commands:
///
///   activate   install the system extension           — routes NOTHING by itself
///   enable     create + turn on the proxy configuration — this is what captures traffic
///
/// and the reverse:
///
///   disable    turn the proxy configuration off        — traffic goes direct again
///   remove     delete the proxy configuration
///   deactivate uninstall the system extension
///
///   status     read-only report                         (default)
///   preflight  run the enable safety checks, change nothing
///
/// `disable` is the kill switch. It needs no daemon, no network and no health
/// check — only the system's NE preferences — so it works when the daemon has
/// crashed or the extension is wedged.

let extensionID = "io.wrapbox.WrapboxProxy.extension"

func say(_ s: String) { print(s); fflush(stdout) }
func done(_ code: Int32) -> Never { fflush(stdout); exit(code) }

func vpnStatus(_ s: NEVPNStatus) -> String {
    switch s {
    case .invalid: return "invalid"
    case .disconnected: return "disconnected"
    case .connecting: return "connecting"
    case .connected: return "connected (routing TCP/443 through Wrapbox)"
    case .reasserting: return "reasserting"
    case .disconnecting: return "disconnecting"
    @unknown default: return "unknown(\(s.rawValue))"
    }
}

/// Our NETransparentProxyManager, if one exists. Identified by provider bundle
/// ID, never by display name.
func loadOurManager(_ then: @escaping (NETransparentProxyManager?, Error?) -> Void) {
    NETransparentProxyManager.loadAllFromPreferences { managers, error in
        let ours = managers?.first {
            ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == extensionID
        }
        then(ours, error)
    }
}

// MARK: - system extension install / uninstall / properties

final class SysExt: NSObject, OSSystemExtensionRequestDelegate {
    var onProperties: (([OSSystemExtensionProperties]?, Error?) -> Void)?
    var exitOnFinish = true

    func submit(_ r: OSSystemExtensionRequest) {
        r.delegate = self
        OSSystemExtensionManager.shared.submitRequest(r)
    }
    func request(_ request: OSSystemExtensionRequest,
                 actionForReplacingExtension existing: OSSystemExtensionProperties,
                 withExtension ext: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplacementAction {
        say("replacing extension build \(existing.bundleVersion) with \(ext.bundleVersion)")
        return .replace
    }
    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        say("waiting for your approval in System Settings > General > Login Items & Extensions.")
        say("Installing it routes NOTHING — traffic is only captured after `enable`.")
    }
    func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) {
        say("system extension request finished (result \(result.rawValue))")
        if exitOnFinish { done(0) }
    }
    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) {
        if let cb = onProperties { onProperties = nil; cb(nil, error); return }
        say("system extension request failed: \(error.localizedDescription)")
        done(1)
    }
    func request(_ request: OSSystemExtensionRequest, foundProperties properties: [OSSystemExtensionProperties]) {
        if let cb = onProperties { onProperties = nil; cb(properties, nil) }
    }
}
let sysext = SysExt()

// MARK: - commands

func cmdStatus() {
    say("Wrapbox network extension — status (read-only, changes nothing)")
    let group = DispatchGroup()
    var lines: [String] = []
    let q = DispatchQueue(label: "status")

    group.enter()
    sysext.exitOnFinish = false
    sysext.onProperties = { props, error in
        q.sync {
            if let error { lines.append("  system extension : could not query (\(error.localizedDescription))") }
            else if let p = props?.first(where: { $0.bundleIdentifier == extensionID }) {
                let state = p.isUninstalling ? "uninstalling" : p.isAwaitingUserApproval ? "awaiting your approval"
                    : p.isEnabled ? "installed, enabled" : "installed, disabled"
                lines.append("  system extension : \(state) (build \(p.bundleVersion))")
            } else { lines.append("  system extension : not installed") }
        }
        group.leave()
    }
    sysext.submit(OSSystemExtensionRequest.propertiesRequest(forExtensionWithIdentifier: extensionID, queue: .main))

    group.enter()
    loadOurManager { m, error in
        guard let m else {
            q.sync { lines.append("  proxy config     : " + (error.map { "could not load (\($0.localizedDescription))" } ?? "none — nothing is routed through Wrapbox")) }
            group.leave(); return
        }
        q.sync { lines.append("  proxy config     : present, enabled=\(m.isEnabled), \(vpnStatus(m.connection.status))") }
        if m.connection.status == .connected, let session = m.connection as? NETunnelProviderSession {
            do {
                try session.sendProviderMessage(Data("status".utf8)) { reply in
                    let text = reply.flatMap { String(data: $0, encoding: .utf8) } ?? "no reply"
                    q.sync { lines.append("  extension counts : \(text)") }
                    group.leave()
                }
            } catch {
                q.sync { lines.append("  extension counts : unavailable (\(error.localizedDescription))") }
                group.leave()
            }
        } else { group.leave() }
    }

    group.enter()
    var cfg = DaemonDialer.Config(); cfg.connectTimeout = 2; cfg.replyTimeout = 3
    DaemonDialer(config: cfg, queue: q).open(host: BrickGuard.ordinaryHost, port: 443) { r in
        switch r {
        case .success(let t): t.connection.cancel(); lines.append("  daemon           : listening on 127.0.0.1:4180, answering CONNECT")
        case .failure(.refused(let s)): lines.append("  daemon           : listening, but refused \(BrickGuard.ordinaryHost): \(s)")
        case .failure(let f): lines.append("  daemon           : \(f)")
        }
        group.leave()
    }

    group.notify(queue: .main) {
        q.sync { lines.sorted().forEach(say) }
        done(0)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 15) { say("  (status timed out waiting on the system)"); done(1) }
}

func printChecks(_ checks: [BrickGuard.Check]) -> Bool {
    for c in checks { say("  \(c.ok ? "PASS" : "FAIL")  \(c.name) — \(c.detail)") }
    return checks.count == 3 && checks.allSatisfy(\.ok)
}

func cmdPreflight() {
    say("Wrapbox enable preflight — safety checks only, changes nothing")
    BrickGuard.run { checks in
        DispatchQueue.main.async {
            let ok = printChecks(checks)
            say(ok ? "\nPreflight PASSED — `enable` would be allowed." : "\nPreflight FAILED — `enable` would refuse.")
            done(ok ? 0 : 2)
        }
    }
}

func cmdEnable() {
    say("Wrapbox enable — safety checks first")
    BrickGuard.run { checks in
        DispatchQueue.main.async {
            guard printChecks(checks) else {
                say("\n✖ REFUSING to enable routing. Nothing was changed.")
                say("  Enabling now would put every app's HTTPS behind a check that is failing,")
                say("  and could take this Mac off the web — including the console needed to fix it.")
                done(2)
            }
            loadOurManager { existing, error in
                if let error { say("could not load proxy configurations: \(error.localizedDescription)"); done(1) }
                let m = existing ?? NETransparentProxyManager()
                let proto = NETunnelProviderProtocol()
                proto.providerBundleIdentifier = extensionID
                proto.serverAddress = DaemonDialer.Config().host   // required non-empty; the daemon
                m.protocolConfiguration = proto
                m.localizedDescription = "Wrapbox"
                m.isEnabled = true
                m.saveToPreferences { error in
                    if let error { say("saving the configuration failed: \(error.localizedDescription)"); done(1) }
                    m.loadFromPreferences { _ in
                        do { try m.connection.startVPNTunnel() }
                        catch { say("starting the proxy failed: \(error.localizedDescription)"); done(1) }
                        say("routing requested — waiting for the system to report status…")
                        DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
                            say("proxy status: \(vpnStatus(m.connection.status))")
                            say("To stop routing at any time: WrapboxApp disable")
                            done(m.connection.status == .connected ? 0 : 1)
                        }
                    }
                }
            }
        }
    }
}

func cmdDisable() {
    say("Wrapbox disable — stop routing (no daemon or network needed)")
    loadOurManager { m, error in
        guard let m else {
            say(error.map { "could not load configurations: \($0.localizedDescription)" }
                ?? "No Wrapbox proxy configuration exists — nothing is routed through Wrapbox.")
            done(error == nil ? 0 : 1)
        }
        m.connection.stopVPNTunnel()
        m.isEnabled = false
        m.saveToPreferences { error in
            if let error { say("disable failed: \(error.localizedDescription)"); done(1) }
            say("Routing is OFF. Apps connect directly again. The extension stays installed.")
            done(0)
        }
    }
}

func cmdRemove() {
    say("Wrapbox remove — delete the proxy configuration")
    loadOurManager { m, _ in
        guard let m else { say("No Wrapbox proxy configuration exists."); done(0) }
        m.connection.stopVPNTunnel()
        m.removeFromPreferences { error in
            if let error { say("remove failed: \(error.localizedDescription)"); done(1) }
            say("Proxy configuration removed.")
            done(0)
        }
    }
}

// MARK: - dispatch

switch CommandLine.arguments.dropFirst().first ?? "status" {
case "status":     cmdStatus()
case "preflight":  cmdPreflight()
case "enable":     cmdEnable()
case "disable":    cmdDisable()
case "remove":     cmdRemove()
case "activate":
    sysext.submit(OSSystemExtensionRequest.activationRequest(forExtensionWithIdentifier: extensionID, queue: .main))
    say("submitted system extension INSTALL request (routes nothing until `enable`)")
case "deactivate":
    sysext.submit(OSSystemExtensionRequest.deactivationRequest(forExtensionWithIdentifier: extensionID, queue: .main))
    say("submitted system extension UNINSTALL request")
default:
    say("usage: WrapboxApp [status|preflight|enable|disable|remove|activate|deactivate]")
    done(64)
}
dispatchMain()
