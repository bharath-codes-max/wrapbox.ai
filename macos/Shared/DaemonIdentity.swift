import Foundation
import Darwin

/// Decides whether a flow was opened by the Wrapbox daemon itself.
///
/// Source: `NEFlowMetaData.sourceAppAuditToken` — documented in the macOS 27 SDK
/// as "Audit token of the source application of the flow", nullable, and the
/// mechanism Apple DTS recommends for identifying a transparent-proxy flow's
/// origin. It identifies the IMMEDIATE socket-owning process (e.g. WebKit's
/// networking process rather than Safari), which is the direction we need: the
/// daemon's node process opens its own sockets.
///
/// "Is the daemon" means: the source process currently owns the TCP listener on
/// 127.0.0.1:<port> — see ProcessSocketProbe. Results are cached per
/// (pid, pidversion); pidversion changes when a PID is reused, so a recycled PID
/// can never inherit a cached exemption.
///
/// FAILURE DIRECTION IS ALWAYS "ROUTE": a missing/short token, or any lookup
/// failure, answers false — the flow goes through the daemon and is enforced.
/// Exempting the unknown would be a bypass; routing the unknown can at worst
/// cost availability, which the rollback drill checks for.
final class DaemonIdentity {

    struct Key: Hashable { let pid: pid_t; let version: Int32 }

    private let port: UInt16
    private let positiveTTL: TimeInterval
    private let negativeTTL: TimeInterval
    private var cache: [Key: (isDaemon: Bool, at: Date)] = [:]
    private let lock = NSLock()

    /// Flows that arrived with no usable audit token. Reported by `status`; a
    /// non-zero value for the daemon's egress would mean the loop guard is blind.
    private(set) var tokenlessFlows = 0

    init(port: UInt16 = 4180, positiveTTL: TimeInterval = 60, negativeTTL: TimeInterval = 10) {
        self.port = port
        self.positiveTTL = positiveTTL
        self.negativeTTL = negativeTTL
    }

    /// Extracts (pid, pidversion) from an audit token blob, or nil if unusable.
    static func key(fromAuditToken data: Data?) -> Key? {
        guard let data, data.count == MemoryLayout<audit_token_t>.size else { return nil }
        var token = audit_token_t()
        _ = withUnsafeMutableBytes(of: &token) { data.copyBytes(to: $0) }
        let pid = audit_token_to_pid(token)
        guard pid > 0 else { return nil }
        return Key(pid: pid, version: audit_token_to_pidversion(token))
    }

    func isDaemon(auditToken: Data?) -> Bool {
        guard let key = Self.key(fromAuditToken: auditToken) else {
            lock.lock(); tokenlessFlows += 1; lock.unlock()
            return false                                   // unknown source => route
        }
        lock.lock()
        if let hit = cache[key], Date().timeIntervalSince(hit.at) < (hit.isDaemon ? positiveTTL : negativeTTL) {
            lock.unlock()
            return hit.isDaemon
        }
        lock.unlock()

        let answer = ProcessSocketProbe.ownsLoopbackListener(pid: key.pid, port: port)

        lock.lock()
        if cache.count > 4096 { cache.removeAll(keepingCapacity: true) }   // bounded memory
        cache[key] = (answer, Date())
        lock.unlock()
        return answer
    }
}
