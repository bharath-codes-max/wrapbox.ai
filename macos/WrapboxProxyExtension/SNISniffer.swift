import Foundation

/// Extracts the server name from a TLS ClientHello.
///
/// WHY THIS EXISTS: a transparent proxy is handed a flow that the application
/// already resolved, so the destination is usually an IP address. `CONNECT
/// 104.18.2.1:443` would break every host-based rule in the contract AND make
/// the daemon mint a certificate for an IP, which the client would reject.
/// `NEAppProxyFlow.remoteHostname` covers apps that use a connect-by-name API
/// (NSURLSession, Network.framework) but is nil for anything doing its own DNS
/// — Chrome, curl, node. For those, the hostname is in the ClientHello.
///
/// Parsing is strictly bounds-checked and never throws: this reads bytes from
/// the network, so a malformed record must return nil, not crash the extension
/// that every connection on the Mac depends on.
enum SNISniffer {

    /// Returns the SNI host_name, or nil if `data` is not a ClientHello that
    /// carries one (including the case where the record is not yet complete).
    static func hostname(in data: Data) -> String? {
        var p = 0
        func need(_ n: Int) -> Bool { p + n <= data.count }
        func u8() -> Int { defer { p += 1 }; return Int(data[data.startIndex + p]) }
        func u16() -> Int { let a = u8(); let b = u8(); return (a << 8) | b }

        // TLS record: type(1) version(2) length(2)
        guard need(5) else { return nil }
        guard u8() == 0x16 else { return nil }   // handshake
        p += 2                                   // record version
        let recordLen = u16()
        guard recordLen > 0, need(recordLen) else { return nil }

        // Handshake: type(1) length(3)
        guard need(4) else { return nil }
        guard u8() == 0x01 else { return nil }   // client_hello
        p += 3                                   // handshake length

        // client_version(2) random(32)
        guard need(2 + 32) else { return nil }
        p += 2 + 32

        // session_id
        guard need(1) else { return nil }
        let sidLen = u8()
        guard need(sidLen) else { return nil }
        p += sidLen

        // cipher_suites
        guard need(2) else { return nil }
        let csLen = u16()
        guard need(csLen) else { return nil }
        p += csLen

        // compression_methods
        guard need(1) else { return nil }
        let cmLen = u8()
        guard need(cmLen) else { return nil }
        p += cmLen

        // extensions
        guard need(2) else { return nil }
        let extTotal = u16()
        let extEnd = p + extTotal
        guard extTotal > 0, extEnd <= data.count else { return nil }

        while p + 4 <= extEnd {
            let type = u16()
            let len = u16()
            guard p + len <= extEnd else { return nil }
            if type == 0x0000 {                  // server_name
                var q = p
                let listEnd = p + len
                guard q + 2 <= listEnd else { return nil }
                q += 2                           // server_name_list length
                guard q + 3 <= listEnd else { return nil }
                let nameType = Int(data[data.startIndex + q]); q += 1
                let nameLen = (Int(data[data.startIndex + q]) << 8) | Int(data[data.startIndex + q + 1]); q += 2
                guard nameType == 0, nameLen > 0, q + nameLen <= listEnd else { return nil }
                let bytes = data.subdata(in: data.index(data.startIndex, offsetBy: q) ..< data.index(data.startIndex, offsetBy: q + nameLen))
                guard let host = String(data: bytes, encoding: .utf8), !host.isEmpty else { return nil }
                return host
            }
            p += len
        }
        return nil
    }
}
