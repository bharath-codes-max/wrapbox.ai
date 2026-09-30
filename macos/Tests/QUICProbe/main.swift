import Foundation
import Network

/// quic-probe <host> [seconds]
///
/// Attempts a real QUIC handshake with ALPN "h3" to <host>:443 using
/// Network.framework's built-in QUIC — no curl, no extra dependency.
///
///   exit 0  "H3 REACHABLE"  — UDP/443 QUIC completed a handshake. Before the
///                             extension is enabled this is EXPECTED and proves
///                             the bypass path is real. After enable it would
///                             mean QUIC is escaping inspection: a FAIL.
///   exit 1  "H3 BLOCKED"    — no handshake. After enable, this is the PASS.
///
/// QUIC runs over UDP, so the system HTTP proxy never applies to it: this probe
/// is exactly the traffic a TCP-only design would silently miss.
let host = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "cloudflare-quic.com"
let limit = CommandLine.arguments.count > 2 ? Double(CommandLine.arguments[2])! : 8

let quic = NWProtocolQUIC.Options(alpn: ["h3"])
let params = NWParameters(quic: quic)
let conn = NWConnection(host: .init(host), port: 443, using: params)
let t0 = Date()
conn.stateUpdateHandler = { state in
    switch state {
    case .ready:
        let ms = Int(Date().timeIntervalSince(t0) * 1000)
        print("H3 REACHABLE: QUIC handshake with \(host):443 completed in \(ms) ms (ALPN h3, UDP)")
        conn.cancel(); exit(0)
    case .failed(let e):
        print("H3 BLOCKED: QUIC to \(host):443 failed — \(e)")
        exit(1)
    default: break
    }
}
conn.start(queue: .main)
DispatchQueue.main.asyncAfter(deadline: .now() + limit) {
    print("H3 BLOCKED: no QUIC handshake with \(host):443 within \(Int(limit))s (state: \(conn.state))")
    exit(1)
}
dispatchMain()
