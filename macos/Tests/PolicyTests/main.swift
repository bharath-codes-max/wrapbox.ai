import Foundation
import Network
import NetworkExtension
import Darwin

// FlowPolicy (fixes A and E) and DaemonIdentity (fix B). No network, no daemon.
var pass = 0, fail = 0
func check(_ name: String, _ ok: Bool, _ detail: String = "") {
    if ok { pass += 1 } else { fail += 1 }
    print("  \(ok ? "PASS" : "FAIL")  \(name)\(detail.isEmpty ? "" : "  [\(detail)]")")
}

print("── FlowPolicy decisions ──")
check("TCP/443 from an app            -> route",  FlowPolicy.tcp(port: 443, fromDaemon: false) == .route)
check("TCP/443 from the daemon        -> bypass (loop guard)", FlowPolicy.tcp(port: 443, fromDaemon: true) == .bypass)
check("TCP/80                         -> bypass (fix A: never routed)", FlowPolicy.tcp(port: 80, fromDaemon: false) == .bypass)
check("UDP/443 (QUIC/HTTP3)           -> drop (fix E)", FlowPolicy.udp(port: 443) == .drop)
check("UDP/53 (DNS)                   -> bypass", FlowPolicy.udp(port: 53) == .bypass)

print("── FlowPolicy.includedRules (what the OS delivers at all) ──")
let rules = FlowPolicy.includedRules()
check("exactly four rules", rules.count == 4, "\(rules.count)")
var combos = Set<String>()
var allPort443 = true, allOutbound = true, anyLoopback = false
for r in rules {
    guard case let .hostPort(host, port)? = r.matchRemoteHostOrNetworkEndpoint else { allPort443 = false; continue }
    if port.rawValue != 443 { allPort443 = false }
    if r.matchDirection != .outbound { allOutbound = false }
    let h = "\(host)"
    if h.hasPrefix("127.") || h == "::1" { anyLoopback = true }
    combos.insert("\(h)/\(r.matchProtocol == .TCP ? "TCP" : r.matchProtocol == .UDP ? "UDP" : "ANY")")
}
check("every rule is port 443 (so port 80 is never delivered)", allPort443)
check("every rule is outbound", allOutbound)
check("IPv4 + IPv6 × TCP + UDP all covered", combos == ["0.0.0.0/TCP", "0.0.0.0/UDP", "::/TCP", "::/UDP"], combos.sorted().joined(separator: ","))
check("no rule targets loopback (daemon hop never re-captured)", !anyLoopback)

print("── DaemonIdentity (audit token -> pid -> live listener check) ──")
func ownToken() -> Data {
    var tok = audit_token_t()
    var n = mach_msg_type_number_t(MemoryLayout<audit_token_t>.size / MemoryLayout<natural_t>.size)
    _ = withUnsafeMutablePointer(to: &tok) { $0.withMemoryRebound(to: integer_t.self, capacity: Int(n)) {
        task_info(mach_task_self_, task_flavor_t(TASK_AUDIT_TOKEN), $0, &n) } }
    return withUnsafeBytes(of: &tok) { Data($0) }
}
func listen(_ port: UInt16) -> Int32 {
    let fd = socket(AF_INET, SOCK_STREAM, 0); var one: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, socklen_t(MemoryLayout<Int32>.size))
    var a = sockaddr_in(); a.sin_family = sa_family_t(AF_INET); a.sin_port = port.bigEndian
    a.sin_addr.s_addr = UInt32(0x7F00_0001).bigEndian
    _ = withUnsafePointer(to: &a) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
    Darwin.listen(fd, 4); return fd
}
let tok = ownToken()
check("audit token -> pid is this process", DaemonIdentity.key(fromAuditToken: tok)?.pid == getpid())

let id = DaemonIdentity(port: 47661, positiveTTL: 0.3, negativeTTL: 0.3)
check("nil token      -> not daemon (route)", id.isDaemon(auditToken: nil) == false)
check("3-byte token   -> not daemon (route)", id.isDaemon(auditToken: Data([1, 2, 3])) == false)
check("token-less flows are counted for `status`", id.tokenlessFlows == 2, "\(id.tokenlessFlows)")
check("process WITHOUT the listener -> not daemon", id.isDaemon(auditToken: tok) == false)
let fd = listen(47661)
usleep(400_000)   // let the negative cache entry expire
check("process that OWNS 127.0.0.1:47661 -> daemon", id.isDaemon(auditToken: tok) == true)
close(fd)
usleep(400_000)   // let the positive cache entry expire
check("after it stops listening -> no longer daemon (re-checked live)", id.isDaemon(auditToken: tok) == false)

print("\nPolicy+Identity: PASS \(pass) / FAIL \(fail)")
exit(fail == 0 ? 0 : 1)
