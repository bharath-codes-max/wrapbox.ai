import Foundation
import Network
import NetworkExtension
import os.log

/// Moves one captured TCP flow through the existing Wrapbox daemon.
///
/// THE WHOLE POINT: this class speaks the daemon's EXISTING protocol. wrapboxd
/// is already an HTTP proxy that understands `CONNECT host:port` — that is what
/// the browser sends it today when the system proxy is set. So the extension is
/// just another client of that same interface. No daemon change, no policy,
/// no classifier, no transform, no receipt logic lives here.
///
/// Sequence:
///   1. open the flow
///   2. read the first chunk from the app (needed to learn the hostname via SNI)
///   3. CONNECT to 127.0.0.1:4180 naming the real host
///   4. on "200", replay that first chunk and pump both directions
///
/// If the daemon is not listening, or refuses the CONNECT, the flow is closed.
/// That is the fail-closed direction: no bytes reach the destination.
final class FlowRouter {

    private let flow: NEAppProxyTCPFlow
    /// Hostname the OS already knew (connect-by-name APIs); empty when unknown.
    private let hostHint: String
    /// The real destination address, used only if no hostname can be learned.
    private let fallbackAddress: String
    private let port: UInt16
    private let log: Logger
    private let conn: NWConnection
    private let queue = DispatchQueue(label: "io.wrapbox.proxy.flow")
    private var finished = false

    /// Where the existing daemon listens. Loopback is never re-captured by the
    /// proxy (NENetworkRule excludes loopback unless asked for), so this hop is
    /// safe by construction.
    static let daemonHost = "127.0.0.1"
    static let daemonPort: UInt16 = 4180

    init(flow: NEAppProxyTCPFlow, hostHint: String, fallbackAddress: String, port: UInt16, log: Logger) {
        self.flow = flow
        self.hostHint = hostHint
        self.fallbackAddress = fallbackAddress
        self.port = port
        self.log = log
        self.conn = NWConnection(
            host: .init(FlowRouter.daemonHost),
            port: .init(integerLiteral: FlowRouter.daemonPort),
            using: .tcp)
    }

    func start() {
        flow.open(withLocalFlowEndpoint: nil) { [weak self] error in
            guard let self else { return }
            if let error {
                self.log.error("flow open failed: \(error.localizedDescription, privacy: .public)")
                self.stop()
                return
            }
            self.readFirstChunkThenConnect()
        }
    }

    /// The first chunk is read BEFORE dialling the daemon because it carries the
    /// ClientHello, and the CONNECT line needs the hostname from it.
    private func readFirstChunkThenConnect() {
        flow.readData { [weak self] data, error in
            guard let self else { return }
            guard let data, !data.isEmpty, error == nil else { self.stop(); return }
            let resolved = (self.hostHint.isEmpty ? nil : self.hostHint)
                ?? SNISniffer.hostname(in: data)
                ?? self.fallbackAddress
            self.dialDaemon(firstChunk: data, hostname: resolved)
        }
    }

    private func dialDaemon(firstChunk: Data, hostname: String) {
        conn.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:      self.sendConnect(firstChunk: firstChunk, hostname: hostname)
            case .failed(let e):
                self.log.error("daemon unreachable: \(e.localizedDescription, privacy: .public)")
                self.stop()                       // fail closed — nothing forwarded
            case .cancelled:  self.stop()
            default:          break
            }
        }
        conn.start(queue: queue)
    }

    private func sendConnect(firstChunk: Data, hostname: String) {
        // An IPv6 literal must be bracketed in a CONNECT target (RFC 7230).
        let h = hostname.contains(":") ? "[\(hostname)]" : hostname
        let target = "\(h):\(port)"
        let req = "CONNECT \(target) HTTP/1.1\r\nHost: \(target)\r\nProxy-Connection: Keep-Alive\r\n\r\n"
        conn.send(content: Data(req.utf8), completion: .contentProcessed { [weak self] error in
            guard let self else { return }
            if error != nil { self.stop(); return }
            self.awaitConnectReply(firstChunk: firstChunk)
        })
    }

    /// Read until the end of the proxy's response headers, then check for 200.
    private func awaitConnectReply(firstChunk: Data, accumulated: Data = Data()) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] chunk, _, _, error in
            guard let self else { return }
            guard let chunk, !chunk.isEmpty, error == nil else { self.stop(); return }
            var buf = accumulated
            buf.append(chunk)
            guard let headerEnd = buf.range(of: Data("\r\n\r\n".utf8)) else {
                if buf.count > 16384 { self.stop(); return }      // runaway header
                self.awaitConnectReply(firstChunk: firstChunk, accumulated: buf)
                return
            }
            let statusLine = String(decoding: buf[buf.startIndex ..< headerEnd.lowerBound], as: UTF8.self)
                .split(separator: "\r\n").first.map(String.init) ?? ""
            guard statusLine.contains(" 200") else {
                // The daemon refused (blocked by policy, or no ruleset). Closing
                // the flow is the correct, fail-closed outcome.
                self.log.info("daemon refused \(self.fallbackAddress, privacy: .public): \(statusLine, privacy: .public)")
                self.stop()
                return
            }
            // Anything after the headers is already tunnel payload.
            let leftover = buf[headerEnd.upperBound...]
            if !leftover.isEmpty { self.flow.write(Data(leftover)) { _ in } }
            self.conn.send(content: firstChunk, completion: .contentProcessed { _ in })
            self.pumpAppToDaemon()
            self.pumpDaemonToApp()
        }
    }

    private func pumpAppToDaemon() {
        flow.readData { [weak self] data, error in
            guard let self else { return }
            guard let data, !data.isEmpty, error == nil else { self.stop(); return }
            self.conn.send(content: data, completion: .contentProcessed { [weak self] err in
                guard let self else { return }
                if err != nil { self.stop(); return }
                self.pumpAppToDaemon()
            })
        }
    }

    private func pumpDaemonToApp() {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let data, !data.isEmpty {
                self.flow.write(data) { [weak self] err in
                    guard let self else { return }
                    if err != nil { self.stop(); return }
                    self.pumpDaemonToApp()
                }
                return
            }
            if isComplete || error != nil { self.stop() }
        }
    }

    private func stop() {
        guard !finished else { return }
        finished = true
        conn.cancel()
        flow.closeReadWithError(nil)
        flow.closeWriteWithError(nil)
    }
}
