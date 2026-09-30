import Foundation
import Network
import NetworkExtension
import os.log

/// Carries one captured TCP/443 flow through the existing Wrapbox daemon.
///
/// It speaks the daemon's EXISTING interface — `CONNECT host:port`, exactly what
/// a browser sends it today — so no inspection, policy, transform or receipt
/// logic lives here. The daemon does all of that.
///
/// LIFETIME: the provider owns every router in a registry until `onFinish` runs.
/// (The first version was started as `FlowRouter(...).start()` with only weak
/// captures, so nothing retained it: it would have been freed as soon as
/// handleNewFlow returned and every flow would have hung. Never ran — nothing
/// was ever activated — but this is why the registry exists.)
///
/// All state is touched only on `queue`, so the two pump directions and the
/// dialer can never race on `finished`.
final class FlowRouter {

    private let flow: NEAppProxyTCPFlow
    private let hostHint: String
    private let fallbackAddress: String
    private let port: UInt16
    private let log: Logger
    private let queue = DispatchQueue(label: "io.wrapbox.proxy.flow")
    private let onFinish: (_ failure: DaemonDialer.Failure?) -> Void

    private var conn: NWConnection?
    private var finished = false
    private var appSideDone = false
    private var daemonSideDone = false

    init(flow: NEAppProxyTCPFlow, hostHint: String, fallbackAddress: String, port: UInt16,
         log: Logger, onFinish: @escaping (_ failure: DaemonDialer.Failure?) -> Void) {
        self.flow = flow
        self.hostHint = hostHint
        self.fallbackAddress = fallbackAddress
        self.port = port
        self.log = log
        self.onFinish = onFinish
    }

    func start() {
        flow.open(withLocalFlowEndpoint: nil) { error in
            self.queue.async {
                if let error {
                    self.log.error("flow open failed: \(error.localizedDescription, privacy: .public)")
                    self.stop(nil)
                    return
                }
                self.readFirstChunk()
            }
        }
    }

    /// The first chunk carries the TLS ClientHello; the CONNECT line needs the
    /// hostname from it when the OS did not already know one.
    private func readFirstChunk() {
        flow.readData { data, error in
            self.queue.async {
                guard let data, !data.isEmpty, error == nil else { self.stop(nil); return }
                let host = (self.hostHint.isEmpty ? nil : self.hostHint)
                    ?? SNISniffer.hostname(in: data)
                    ?? self.fallbackAddress
                self.dial(host: host, firstChunk: data)
            }
        }
    }

    private func dial(host: String, firstChunk: Data) {
        DaemonDialer(queue: queue).open(host: host, port: port) { result in
            switch result {
            case .failure(let why):
                // Daemon down, wedged, or said no. Closing the flow IS the
                // fail-closed outcome: not one byte reaches the destination.
                self.log.error("\(host, privacy: .public): \(why.description, privacy: .public)")
                self.stop(why)
            case .success(let tunnel):
                self.conn = tunnel.connection
                if !tunnel.leftover.isEmpty { self.flow.write(tunnel.leftover) { _ in } }
                tunnel.connection.send(content: firstChunk, completion: .contentProcessed { err in
                    self.queue.async {
                        if err != nil { self.stop(nil); return }
                        self.pumpAppToDaemon()
                        self.pumpDaemonToApp()
                    }
                })
            }
        }
    }

    private func pumpAppToDaemon() {
        flow.readData { data, error in
            self.queue.async {
                guard !self.finished, let conn = self.conn else { return }
                if error != nil { self.stop(nil); return }
                guard let data, !data.isEmpty else {
                    // App finished sending (half-close). Tell the daemon, keep reading.
                    self.appSideDone = true
                    conn.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .idempotent)
                    self.stopIfBothDone()
                    return
                }
                conn.send(content: data, completion: .contentProcessed { err in
                    self.queue.async {
                        if err != nil { self.stop(nil); return }
                        self.pumpAppToDaemon()
                    }
                })
            }
        }
    }

    private func pumpDaemonToApp() {
        guard let conn = conn else { return }
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, isComplete, error in
            self.queue.async {
                guard !self.finished else { return }
                if let data, !data.isEmpty {
                    self.flow.write(data) { err in
                        self.queue.async {
                            if err != nil { self.stop(nil); return }
                            if isComplete { self.daemonDone() } else { self.pumpDaemonToApp() }
                        }
                    }
                    return
                }
                if error != nil { self.stop(nil); return }
                if isComplete { self.daemonDone() } else { self.pumpDaemonToApp() }
            }
        }
    }

    private func daemonDone() {
        daemonSideDone = true
        flow.closeWriteWithError(nil)
        stopIfBothDone()
    }

    private func stopIfBothDone() {
        if appSideDone && daemonSideDone { stop(nil) }
    }

    private func stop(_ failure: DaemonDialer.Failure?) {
        guard !finished else { return }
        finished = true
        conn?.cancel()
        conn = nil
        flow.closeReadWithError(nil)
        flow.closeWriteWithError(nil)
        onFinish(failure)
    }
}
