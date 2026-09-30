import Foundation
import Network
import NetworkExtension

/// What the extension captures, and what it does with each captured flow.
///
/// Kept free of NEAppProxyFlow objects so every decision is unit-testable
/// without a running extension.
///
/// RULES FIRST, `return false` LAST. Apple DTS guidance for transparent proxies:
/// "Set up the rules so that you're not passed the flow" — returning NO has been
/// seen to drop flows in edge cases. So everything expressible as a rule lives in
/// `includedRules()`: port 443 only (port 80 is never delivered, fix A), loopback
/// never delivered (NENetworkRule semantics). `return false` is left for the one
/// thing no rule can express: the daemon's own egress.
enum FlowPolicy {

    static let webPort: UInt16 = 443

    enum Decision: Equatable {
        /// Send through the Wrapbox daemon for inspection and policy.
        case route
        /// Let the networking stack handle it directly (TCP `return false`;
        /// documented as bypass for NETransparentProxyProvider).
        case bypass
        /// Claim the flow and close it without forwarding a byte.
        case drop
    }

    /// TCP. The daemon's own connections bypass (loop prevention); everything
    /// else that reaches here is port 443 by construction and is routed.
    static func tcp(port: UInt16, fromDaemon: Bool) -> Decision {
        if fromDaemon { return .bypass }
        return port == webPort ? .route : .bypass
    }

    /// UDP. QUIC / HTTP/3 on 443 is DROPPED so the client falls back to TCP,
    /// which the daemon inspects (fix E). The daemon speaks HTTP over TCP only,
    /// so there is no way to inspect QUIC — letting it through would be a silent
    /// hole, and routing it would simply break it anyway.
    static func udp(port: UInt16) -> Decision {
        port == webPort ? .drop : .bypass
    }

    /// Outbound TCP and UDP to port 443, IPv4 and IPv6. A wildcard address
    /// matches every destination EXCEPT loopback (NENetworkRule.h), so the
    /// extension's own hop to 127.0.0.1:4180 is never re-captured.
    static func includedRules() -> [NENetworkRule] {
        var rules: [NENetworkRule] = []
        for wildcard in ["0.0.0.0", "::"] {
            let ep = NWEndpoint.hostPort(host: NWEndpoint.Host(wildcard),
                                         port: NWEndpoint.Port(rawValue: webPort)!)
            rules.append(NENetworkRule(remoteNetworkEndpoint: ep, remotePrefix: 0,
                                       localNetworkEndpoint: nil, localPrefix: 0,
                                       protocol: .TCP, direction: .outbound))
            rules.append(NENetworkRule(remoteNetworkEndpoint: ep, remotePrefix: 0,
                                       localNetworkEndpoint: nil, localPrefix: 0,
                                       protocol: .UDP, direction: .outbound))
        }
        return rules
    }
}
