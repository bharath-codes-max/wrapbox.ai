import Foundation
let q = DispatchQueue(label: "t")
var pass = 0, fail = 0
func run(_ name: String, port: UInt16, host: String = "example.com", expect: (Result<DaemonDialer.Tunnel, DaemonDialer.Failure>) -> Bool, maxSeconds: Double) {
    var cfg = DaemonDialer.Config(); cfg.port = port; cfg.connectTimeout = 1; cfg.replyTimeout = 1.5
    let sem = DispatchSemaphore(value: 0); let t0 = Date()
    var result: Result<DaemonDialer.Tunnel, DaemonDialer.Failure>!
    DaemonDialer(config: cfg, queue: q).open(host: host, port: 443) { result = $0; sem.signal() }  // NOT retained by the caller on purpose
    if sem.wait(timeout: .now() + maxSeconds + 3) == .timedOut { fail += 1; print("  FAIL  \(name): HUNG (never completed)"); return }
    let dt = Date().timeIntervalSince(t0)
    let desc: String; switch result! { case .success(let t): desc = "success leftover=\(String(decoding: t.leftover, as: UTF8.self))"; t.connection.cancel(); case .failure(let f): desc = "\(f)" }
    let ok = expect(result) && dt <= maxSeconds
    if ok { pass += 1 } else { fail += 1 }
    print(String(format: "  %@  %-40@ %.2fs  %@", ok ? "PASS" : "FAIL", name, dt, desc))
}
func isUnreach(_ r: Result<DaemonDialer.Tunnel, DaemonDialer.Failure>) -> Bool { if case .failure(.unreachable) = r { return true }; return false }
func isTimeout(_ r: Result<DaemonDialer.Tunnel, DaemonDialer.Failure>) -> Bool { if case .failure(.timeout) = r { return true }; return false }
func isRefused(_ r: Result<DaemonDialer.Tunnel, DaemonDialer.Failure>) -> Bool { if case .failure(.refused) = r { return true }; return false }
func isMalformed(_ r: Result<DaemonDialer.Tunnel, DaemonDialer.Failure>) -> Bool { if case .failure(.malformedReply) = r { return true }; return false }
func isUnsafe(_ r: Result<DaemonDialer.Tunnel, DaemonDialer.Failure>) -> Bool { if case .failure(.unsafeHost) = r { return true }; return false }

print("=== DaemonDialer vs fake daemons (connect bound 1s, reply bound 1.5s) ===")
run("dead daemon (nothing listening)",   port: 47701, expect: isUnreach,  maxSeconds: 1.0)
run("daemon accepts, never replies",     port: 47702, expect: isTimeout,  maxSeconds: 2.0)
run("daemon replies 403 (policy)",       port: 47703, expect: isRefused,  maxSeconds: 1.0)
run("daemon replies 200 + payload",      port: 47704, expect: { if case .success(let t) = $0 { return t.leftover == Data("LEFTOVER".utf8) }; return false }, maxSeconds: 1.0)
run("runaway header (20KB, no CRLFCRLF)",port: 47705, expect: isMalformed, maxSeconds: 1.6)
run("non-HTTP reply",                    port: 47706, expect: isMalformed, maxSeconds: 1.0)
run("daemon hangs up immediately",       port: 47707, expect: isUnreach,  maxSeconds: 1.0)
run("SNI with CRLF injection",           port: 47704, host: "evil.com\r\nX-Injected: 1", expect: isUnsafe, maxSeconds: 0.2)
run("SNI with space",                    port: 47704, host: "evil.com x", expect: isUnsafe, maxSeconds: 0.2)
let v6 = DaemonDialer.connectRequest(host: "2001:db8::1", port: 443)
let v6ok = v6.hasPrefix("CONNECT [2001:db8::1]:443 HTTP/1.1\r\nHost: [2001:db8::1]:443\r\n")
if v6ok { pass += 1 } else { fail += 1 }; print("  \(v6ok ? "PASS" : "FAIL")  IPv6 literal is bracketed in CONNECT line")
print("\nDaemonDialer: PASS \(pass) / FAIL \(fail)")
exit(fail == 0 ? 0 : 1)
