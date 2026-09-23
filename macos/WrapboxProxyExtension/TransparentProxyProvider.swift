import Foundation
import Network
import NetworkExtension
import os.log

/// The macOS Network Extension side of Wrapbox.
///
/// SCOPE, DELIBERATELY SMALL: this decides which flows to capture and hands
/// them to the existing daemon. It performs NO inspection, NO classification,
/// NO policy evaluation, NO transformation and writes NO receipts — all of that
/// stays in wrapboxd exactly as it is today. Replacing the system proxy must not
/// become an excuse to fork the enforcement engine into a second language.
final class TransparentProxyProvider: NETransparentProxyProvider {

    private let log = Logger(subsystem: "io.wrapbox.proxy.extension", category: "provider")

    /// Code-signing identifiers whose traffic is NEVER captured.
    ///
    /// THE LOOP: the daemon's own connections to the real internet would
    /// otherwise be captured and handed back to the daemon, forever. Loopback
    /// (extension -> 127.0.0.1:4180) is already excluded by NENetworkRule
    /// semantics, but the daemon's EGRESS is not, so it must be named here.
    /// Read from Info.plist so it can be corrected without a code change —
    /// necessary because an ad-hoc signed Homebrew node changes identifier on
    /// every upgrade. A shipped, signed wrapboxd gets a stable identifier.
    private var excludedSigningIdentifiers: Set<String> = []

    override func startProxy(options: [String: Any]?, completionHandler: @escaping (Error?) -> Void) {
        if let ids = Bundle.main.object(forInfoDictionaryKey: "WBXExcludedSigningIdentifiers") as? [String] {
            excludedSigningIdentifiers = Set(ids)
        }

        let settings = NETransparentProxyNetworkSettings(tunnelRemoteAddress: FlowRouter.daemonHost)

        // nil remote + nil local == "all traffic of this protocol and direction,
        // EXCEPT loopback" (NENetworkRule.h). That exclusion is what makes the
        // extension's own hop to the daemon safe without any extra rule.
        let allOutboundTCP = NENetworkRule(
            remoteNetworkEndpoint: nil, remotePrefix: 0,
            localNetworkEndpoint: nil, localPrefix: 0,
            protocol: .TCP, direction: .outbound)

        settings.includedNetworkRules = [allOutboundTCP]

        setTunnelNetworkSettings(settings) { [weak self] error in
            if let error {
                self?.log.error("settings rejected: \(error.localizedDescription, privacy: .public)")
            } else {
                self?.log.info("wrapbox transparent proxy active — routing to \(FlowRouter.daemonHost):\(FlowRouter.daemonPort, privacy: .public)")
            }
            completionHandler(error)
        }
    }

    override func stopProxy(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        log.info("wrapbox transparent proxy stopping (reason \(reason.rawValue, privacy: .public))")
        completionHandler()
    }

    override func handleNewFlow(_ flow: NEAppProxyFlow) -> Bool {
        // Phase 1 is TCP only. Returning false lets the flow proceed directly.
        guard let tcp = flow as? NEAppProxyTCPFlow else { return false }

        // Never capture the daemon's own egress (see excludedSigningIdentifiers).
        let signer = flow.metaData.sourceAppSigningIdentifier
        if excludedSigningIdentifiers.contains(signer) { return false }

        guard let (address, port) = Self.destination(of: tcp) else { return false }

        // Only web traffic goes through the daemon; it is an HTTP proxy, and
        // handing it SSH or SMTP would simply break those connections.
        guard port == 80 || port == 443 else { return false }

        // Prefer a hostname the OS already knows (connect-by-name APIs). When it
        // is nil — Chrome, curl, node all resolve DNS themselves — FlowRouter
        // falls back to reading the SNI out of the ClientHello.
        FlowRouter(flow: tcp,
                   hostHint: flow.remoteHostname ?? "",
                   fallbackAddress: address,
                   port: port,
                   log: log).start()
        return true
    }

    /// Destination of a captured flow. `remoteFlowEndpoint` bridges into Swift as
    /// the Network.framework `NWEndpoint` enum. For a transparent proxy this is
    /// normally an ADDRESS, because the app already did its own DNS — which is
    /// exactly why SNI sniffing exists downstream.
    private static func destination(of flow: NEAppProxyTCPFlow) -> (String, UInt16)? {
        guard case let .hostPort(host, port) = flow.remoteFlowEndpoint else { return nil }
        let p = port.rawValue
        guard p != 0 else { return nil }
        switch host {
        case .name(let n, _):
            return (n, p)
        case .ipv4(let a):
            return ("\(a)", p)
        case .ipv6(let a):
            // Drop any %interface scope; it is meaningless to the daemon.
            return (String("\(a)".split(separator: "%").first ?? ""), p)
        @unknown default:
            return nil
        }
    }
}
