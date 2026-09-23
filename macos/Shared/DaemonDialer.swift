import Foundation
import Network

/// Opens one tunnel through the local Wrapbox daemon: TCP to 127.0.0.1:4180,
/// `CONNECT host:port`, wait for `200`. Every step is bounded.
///
/// WHY `.waiting` IS A FAILURE HERE: NWConnection reports a refused connection
/// as `.waiting(ECONNREFUSED)` and then waits for a network *path change* before
/// retrying. On loopback no such change ever comes, so a dead daemon would leave
/// every captured connection hanging forever (verified: still `.waiting` after
/// 6s). For this hop, "waiting" can only mean "the daemon is not there", so it
/// fails at once — the flow is closed, nothing is forwarded (fail-closed, fast).
///
/// Shared by the extension (to carry each flow) and the container app (the
/// pre-enable brick guard), so both judge the daemon the same way.
final class DaemonDialer {

    struct Config {
        var host = "127.0.0.1"
        var port: UInt16 = 4180
        /// Loopback connects in microseconds; anything slower is a wedged daemon.
        var connectTimeout: TimeInterval = 3
        /// The daemon decides CONNECT on the hostname alone; 5s is generous.
        var replyTimeout: TimeInterval = 5
        var maxHeaderBytes = 16 * 1024
    }

    enum Failure: Error, Equatable, CustomStringConvertible {
        case unsafeHost(String)      // would inject into the CONNECT line
        case unreachable(String)     // refused / no listener / failed / cancelled
        case timeout(String)         // a bound was exceeded
        case refused(String)         // daemon answered, not 200 (policy said no)
        case malformedReply

        var description: String {
            switch self {
            case .unsafeHost(let h):   return "unsafe hostname rejected: \(h.debugDescription)"
            case .unreachable(let w):  return "daemon unreachable: \(w)"
            case .timeout(let w):      return "daemon timed out: \(w)"
            case .refused(let s):      return "daemon refused: \(s)"
            case .malformedReply:      return "daemon sent a malformed CONNECT reply"
            }
        }
    }

    /// A successful tunnel: the ready connection plus any bytes that arrived
    /// after the reply headers (already tunnel payload — must not be lost).
    struct Tunnel {
        let connection: NWConnection
        let leftover: Data
    }

    /// A hostname that can safely go on a CONNECT line. SNI is read from bytes
    /// the client sent, so a crafted ClientHello could carry "\r\n" and smuggle
    /// headers into the request to the daemon. Accept only DNS names and IP
    /// literals; anything else is refused and the flow closed.
    static func isSafeHost(_ h: String) -> Bool {
        guard !h.isEmpty, h.utf8.count <= 253 else { return false }
        return h.utf8.allSatisfy { c in
            (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)
                || c == 0x2E /* . */ || c == 0x2D /* - */ || c == 0x3A /* : (IPv6) */
        }
    }

    /// The exact request line sent to the daemon. IPv6 literals are bracketed.
    static func connectRequest(host: String, port: UInt16) -> String {
        let h = host.contains(":") ? "[\(host)]" : host
        let target = "\(h):\(port)"
        return "CONNECT \(target) HTTP/1.1\r\nHost: \(target)\r\nProxy-Connection: Keep-Alive\r\n\r\n"
    }

    private let config: Config
    private let queue: DispatchQueue
    private var connection: NWConnection?
    private var completion: ((Result<Tunnel, Failure>) -> Void)?
    private var ready = false

    init(config: Config = Config(), queue: DispatchQueue) {
        self.config = config
        self.queue = queue
    }

    /// Opens the tunnel; `completion` is called exactly once, on `queue`.
    func open(host: String, port: UInt16, completion: @escaping (Result<Tunnel, Failure>) -> Void) {
        queue.async { [self] in
            self.completion = completion
            guard Self.isSafeHost(host) else { finish(.failure(.unsafeHost(host))); return }

            let conn = NWConnection(host: .init(config.host),
                                    port: .init(integerLiteral: config.port),
                                    using: .tcp)
            connection = conn

            queue.asyncAfter(deadline: .now() + config.connectTimeout) { [weak self] in
                guard let self, !self.ready else { return }
                self.finish(.failure(.timeout("connect exceeded \(self.config.connectTimeout)s")))
            }

            // Strong capture on purpose: the dialer keeps itself alive until it
            // completes (so a caller cannot drop it mid-flight and leave a flow
            // hanging). finish() breaks the cycle by clearing this handler.
            conn.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    guard !self.ready else { return }
                    self.ready = true
                    self.sendConnect(host: host, port: port)
                case .waiting(let e):
                    self.finish(.failure(.unreachable("waiting (\(e.localizedDescription))")))
                case .failed(let e):
                    self.finish(.failure(.unreachable("failed (\(e.localizedDescription))")))
                case .cancelled:
                    self.finish(.failure(.unreachable("cancelled")))
                default:
                    break
                }
            }
            conn.start(queue: queue)
        }
    }

    private func sendConnect(host: String, port: UInt16) {
        guard let conn = connection else { return }
        queue.asyncAfter(deadline: .now() + config.replyTimeout) { [weak self] in
            guard let self, self.completion != nil else { return }
            self.finish(.failure(.timeout("CONNECT reply exceeded \(self.config.replyTimeout)s")))
        }
        conn.send(content: Data(Self.connectRequest(host: host, port: port).utf8),
                  completion: .contentProcessed { error in
            if let error { self.finish(.failure(.unreachable("send (\(error.localizedDescription))"))); return }
            self.readReply(accumulated: Data())
        })
    }

    private func readReply(accumulated: Data) {
        guard let conn = connection, completion != nil else { return }
        conn.receive(minimumIncompleteLength: 1, maximumLength: 8192) { chunk, _, isComplete, error in
            guard self.completion != nil else { return }
            var buf = accumulated
            if let chunk { buf.append(chunk) }
            if let end = buf.range(of: Data("\r\n\r\n".utf8)) {
                let status = String(decoding: buf[buf.startIndex ..< end.lowerBound], as: UTF8.self)
                    .components(separatedBy: "\r\n").first ?? ""
                let parts = status.split(separator: " ", maxSplits: 2)
                guard parts.count >= 2, parts[0].hasPrefix("HTTP/1.") else { self.finish(.failure(.malformedReply)); return }
                guard parts[1] == "200" else { self.finish(.failure(.refused(status))); return }
                self.finish(.success(Tunnel(connection: conn, leftover: Data(buf[end.upperBound...]))))
                return
            }
            if buf.count > self.config.maxHeaderBytes { self.finish(.failure(.malformedReply)); return }
            if isComplete || error != nil { self.finish(.failure(.unreachable("closed before reply"))); return }
            self.readReply(accumulated: buf)
        }
    }

    /// Exactly-once completion. On failure the connection is torn down; on
    /// success it is handed over and this dialer lets go of it.
    private func finish(_ result: Result<Tunnel, Failure>) {
        guard let done = completion else { return }
        completion = nil
        if case .failure = result {
            connection?.stateUpdateHandler = nil
            connection?.cancel()
        } else {
            connection?.stateUpdateHandler = nil
        }
        connection = nil
        done(result)
    }
}
