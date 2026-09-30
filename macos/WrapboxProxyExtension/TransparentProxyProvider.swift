import Foundation
import Network
import NetworkExtension
import os.log

/// The Wrapbox transparent proxy: capture TCP/443 and UDP/443, hand web flows
/// to the existing daemon, drop QUIC, and never re-capture the daemon itself.
///
/// It performs NO inspection, classification, policy, transformation or
/// receipts — all of that stays in wrapboxd.
final class TransparentProxyProvider: NETransparentProxyProvider, NEAppProxyUDPFlowHandling {

    private let log = Logger(subsystem: "io.wrapbox.proxy.extension", category: "provider")
    private let identity = DaemonIdentity(port: DaemonDialer.Config().port)

    private let lock = NSLock()
    private var routers: [ObjectIdentifier: FlowRouter] = [:]
    private var routed = 0, bypassedDaemon = 0, droppedQUIC = 0, daemonFailures = 0

    // MARK: lifecycle

    override func startProxy(options: [String: Any]?, completionHandler: @escaping (Error?) -> Void) {
        let settings = NETransparentProxyNetworkSettings(tunnelRemoteAddress: DaemonDialer.Config().host)
        settings.includedNetworkRules = FlowPolicy.includedRules()   // TCP+UDP 443, v4+v6, never loopback
        setTunnelNetworkSettings(settings) { [log] error in
            if let error {
                log.error("settings rejected: \(error.localizedDescription, privacy: .public)")
            } else {
                log.info("active: TCP/443 -> daemon, UDP/443 dropped, loopback and daemon egress exempt")
            }
            completionHandler(error)
        }
    }

    override func stopProxy(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        log.info("stopping (reason \(reason.rawValue, privacy: .public))")
        completionHandler()
    }

    // MARK: TCP

    override func handleNewFlow(_ flow: NEAppProxyFlow) -> Bool {
        // Defensive: if a UDP flow is ever delivered here instead of via
        // handleNewUDPFlow, QUIC must still not go direct.
        if let udp = flow as? NEAppProxyUDPFlow {
            return drop(udp, reason: "UDP flow delivered to the TCP path; dropped so QUIC cannot bypass")
        }
        guard let tcp = flow as? NEAppProxyTCPFlow,
              let (address, port) = Self.hostPort(tcp.remoteFlowEndpoint) else { return false }

        let fromDaemon = identity.isDaemon(auditToken: flow.metaData.sourceAppAuditToken)

        switch FlowPolicy.tcp(port: port, fromDaemon: fromDaemon) {
        case .bypass:
            // Documented for NETransparentProxyProvider: returning NO hands the
            // flow to the networking stack unproxied. Used ONLY for the daemon's
            // own egress (no rule can express "this process") — the loop guard.
            if fromDaemon { lock.lock(); bypassedDaemon += 1; lock.unlock() }
            return false
        case .drop:
            return drop(flow, reason: "policy")
        case .route:
            route(tcp, address: address, port: port)
            return true
        }
    }

    private func route(_ tcp: NEAppProxyTCPFlow, address: String, port: UInt16) {
        let hint = tcp.remoteHostname ?? ""
        var router: FlowRouter!
        router = FlowRouter(flow: tcp, hostHint: hint, fallbackAddress: address, port: port, log: log) { [weak self] failure in
            guard let self else { return }
            self.lock.lock()
            self.routers[ObjectIdentifier(router)] = nil
            if failure != nil { self.daemonFailures += 1 }
            self.lock.unlock()
        }
        lock.lock()
        routers[ObjectIdentifier(router)] = router   // owned until onFinish
        routed += 1
        lock.unlock()
        router.start()
    }

    // MARK: UDP (fix E — QUIC / HTTP/3)

    func handleNewUDPFlow(_ flow: NEAppProxyUDPFlow, initialRemoteFlowEndpoint remoteEndpoint: Network.NWEndpoint) -> Bool {
        guard let (_, port) = Self.hostPort(remoteEndpoint) else { return drop(flow, reason: "unparseable UDP endpoint") }
        switch FlowPolicy.udp(port: port) {
        case .drop:
            lock.lock(); droppedQUIC += 1; lock.unlock()
            return drop(flow, reason: "QUIC/HTTP3 on UDP/443 is dropped so the client falls back to inspected TCP")
        case .bypass, .route:
            return false   // only UDP/443 is ever delivered by the rules
        }
    }

    /// Claim the flow and close it without forwarding anything. Deliberately NOT
    /// `return false`: for UDP the SDK documents NO as "terminated" while also
    /// saying the default forwards to handleNewFlow (where NO means bypass). A
    /// flow the proxy owns and never forwards cannot reach the network, whatever
    /// that ambiguity resolves to.
    private func drop(_ flow: NEAppProxyFlow, reason: String) -> Bool {
        flow.open(withLocalFlowEndpoint: nil) { _ in
            let err = NSError(domain: "io.wrapbox.proxy", code: 1, userInfo: [NSLocalizedDescriptionKey: reason])
            flow.closeReadWithError(err)
            flow.closeWriteWithError(err)
        }
        return true
    }

    // MARK: status for the container app

    /// `WrapboxApp status` asks for these while the proxy runs. `tokenlessFlows`
    /// is the one to watch in the drill: flows whose source process the OS did
    /// not identify are ROUTED, so if the daemon's own egress ever arrived
    /// token-less the loop guard would be blind.
    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
        lock.lock()
        let snapshot: [String: Int] = [
            "routed": routed, "bypassedDaemon": bypassedDaemon, "droppedQUIC": droppedQUIC,
            "daemonFailures": daemonFailures, "activeRouters": routers.count,
            "tokenlessFlows": identity.tokenlessFlows,
        ]
        lock.unlock()
        completionHandler?(try? JSONSerialization.data(withJSONObject: snapshot))
    }

    // MARK: helpers

    static func hostPort(_ ep: Network.NWEndpoint) -> (String, UInt16)? {
        guard case let .hostPort(host, port) = ep, port.rawValue != 0 else { return nil }
        switch host {
        case .name(let n, _): return (n, port.rawValue)
        case .ipv4(let a):    return ("\(a)", port.rawValue)
        case .ipv6(let a):    return (String("\(a)".split(separator: "%").first ?? ""), port.rawValue)
        @unknown default:     return nil
        }
    }
}
