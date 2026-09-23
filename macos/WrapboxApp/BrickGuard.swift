import Foundation

/// The pre-enable safety check — the Network Extension's equivalent of the
/// `--protect-network` guard in daemon.ts ("REFUSING to turn on system-wide
/// protection").
///
/// Once routing is enabled, EVERY app's HTTPS goes through the daemon. If the
/// daemon is down, if the contract cannot allow ordinary traffic, or if the
/// Wrapbox CA is not trusted, the whole Mac loses the web — including the
/// console you would use to fix it. So `enable` refuses unless all three hold.
///
/// It does not re-implement policy in Swift (that would be a second engine that
/// could drift). It asks the ONE engine, empirically:
///   1. is the daemon listening and answering CONNECT at all?
///   2. does it ALLOW an ordinary host at the CONNECT stage?
///   3. does a real HTTPS request through it succeed under SYSTEM trust — i.e.
///      would a browser accept the certificate the daemon presents?
/// Check 3 is stronger than the daemon.ts guard: it also catches an untrusted
/// CA, which would break every inspected site the moment routing starts.
///
/// Read-only. Makes one ordinary HTTPS request (to example.com, an IANA
/// reserved host) through the daemon. Changes no setting.
enum BrickGuard {

    struct Check {
        let name: String
        let ok: Bool
        let detail: String
    }

    static let ordinaryHost = "example.com"

    static func run(completion: @escaping ([Check]) -> Void) {
        var checks: [Check] = []
        let q = DispatchQueue(label: "io.wrapbox.guard")

        DaemonDialer(queue: q).open(host: ordinaryHost, port: 443) { result in
            switch result {
            case .success(let tunnel):
                tunnel.connection.cancel()
                checks.append(Check(name: "daemon reachable on 127.0.0.1:4180", ok: true, detail: "answered CONNECT"))
                checks.append(Check(name: "contract allows ordinary traffic", ok: true,
                                    detail: "CONNECT \(ordinaryHost):443 -> 200"))
                endToEnd { checks.append($0); completion(checks) }
            case .failure(.refused(let status)):
                checks.append(Check(name: "daemon reachable on 127.0.0.1:4180", ok: true, detail: "answered CONNECT"))
                checks.append(Check(name: "contract allows ordinary traffic", ok: false,
                                    detail: "CONNECT \(ordinaryHost):443 -> \(status). Enabling would refuse the web on this Mac. Add an ALLOW rule for ordinary traffic first."))
                completion(checks)
            case .failure(let other):
                checks.append(Check(name: "daemon reachable on 127.0.0.1:4180", ok: false,
                                    detail: "\(other). Start it first: wbx daemon --inspect (WITHOUT --protect-network)."))
                completion(checks)
            }
        }
    }

    /// A real HTTPS request routed through the daemon, validated with the
    /// system trust store — exactly what a browser will experience.
    private static func endToEnd(_ done: @escaping (Check) -> Void) {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.connectionProxyDictionary = [
            kCFNetworkProxiesHTTPSEnable as String: true,
            kCFNetworkProxiesHTTPSProxy as String: DaemonDialer.Config().host,
            kCFNetworkProxiesHTTPSPort as String: Int(DaemonDialer.Config().port),
        ]
        cfg.timeoutIntervalForRequest = 15
        cfg.timeoutIntervalForResource = 20
        let name = "HTTPS through the daemon is trusted end-to-end"
        var req = URLRequest(url: URL(string: "https://\(ordinaryHost)/")!)
        req.httpMethod = "HEAD"
        URLSession(configuration: cfg).dataTask(with: req) { _, response, error in
            if let http = response as? HTTPURLResponse {
                if (http.value(forHTTPHeaderField: "x-wrapbox-decision") ?? "").lowercased() == "block" {
                    done(Check(name: name, ok: false, detail: "the daemon BLOCKED an ordinary request (\(http.statusCode))"))
                } else {
                    done(Check(name: name, ok: true, detail: "HTTP \(http.statusCode), certificate accepted by system trust"))
                }
                return
            }
            let ns = error as NSError?
            let certCodes: Set<Int> = [NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasUnknownRoot,
                                       NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateNotYetValid,
                                       NSURLErrorSecureConnectionFailed, NSURLErrorClientCertificateRejected]
            if let ns, ns.domain == NSURLErrorDomain, certCodes.contains(ns.code) {
                done(Check(name: name, ok: false,
                           detail: "certificate rejected (\(ns.code)): the Wrapbox CA is not trusted, so EVERY inspected HTTPS site would fail. Run: wbx ca install"))
            } else {
                done(Check(name: name, ok: false, detail: "request failed: \(ns?.localizedDescription ?? "unknown error")"))
            }
        }.resume()
    }
}
