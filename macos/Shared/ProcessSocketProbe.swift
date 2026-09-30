import Darwin

/// Answers one question about a live process, using only public libproc calls:
/// "does this process own a TCP socket LISTENING on 127.0.0.1:<port>?"
///
/// WHY THIS IS THE DAEMON EXCLUSION: the extension routes captured traffic to
/// 127.0.0.1:4180, so the daemon's own outbound connections must NOT be captured
/// again (that is the loop). The narrowest reliable definition of "the daemon"
/// is *the process that owns that listening socket* — not a code-signing
/// identity. Homebrew node is ad-hoc signed and shared by every node program
/// (Codex, anything under npx), so a signing-identity exemption would wave all of
/// them through enforcement.
///
/// It inspects only the one PID it is given (its own fd table), so there is no
/// scan of every process on the Mac, and a reused PID cannot inherit the
/// exemption: the check is against the live process, which will not own the
/// listener. Any failure (process gone, permission denied) answers `false` —
/// "not the daemon" — which means the flow is ROUTED, the enforcing direction.
enum ProcessSocketProbe {

    static func ownsLoopbackListener(pid: pid_t, port: UInt16) -> Bool {
        guard pid > 0 else { return false }

        // Size the fd list, then fetch it.
        let bytes = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, nil, 0)
        guard bytes > 0 else { return false }
        let capacity = Int(bytes) / MemoryLayout<proc_fdinfo>.stride + 16
        var fds = [proc_fdinfo](repeating: proc_fdinfo(), count: capacity)
        let got = fds.withUnsafeMutableBytes { raw in
            proc_pidinfo(pid, PROC_PIDLISTFDS, 0, raw.baseAddress, Int32(raw.count))
        }
        guard got > 0 else { return false }
        let count = Int(got) / MemoryLayout<proc_fdinfo>.stride

        let wantPort = Int32(port)
        let loopback = UInt32(0x7F00_0001).bigEndian   // 127.0.0.1, network order

        for i in 0 ..< count where fds[i].proc_fdtype == UInt32(PROX_FDTYPE_SOCKET) {
            var si = socket_fdinfo()
            let n = proc_pidfdinfo(pid, fds[i].proc_fd, PROC_PIDFDSOCKETINFO,
                                   &si, Int32(MemoryLayout<socket_fdinfo>.size))
            guard n == Int32(MemoryLayout<socket_fdinfo>.size) else { continue }
            guard si.psi.soi_kind == Int32(SOCKINFO_TCP) else { continue }
            let tcp = si.psi.soi_proto.pri_tcp
            guard tcp.tcpsi_state == TSI_S_LISTEN else { continue }
            let ini = tcp.tcpsi_ini
            // insi_lport is stored in network byte order.
            guard Int32(UInt16(truncatingIfNeeded: ini.insi_lport).bigEndian) == wantPort else { continue }
            // IPv4 loopback only — the daemon binds 127.0.0.1. A listener on
            // 0.0.0.0:4180 is NOT the daemon and must not earn an exemption.
            guard ini.insi_vflag & UInt8(INI_IPV4) != 0 else { continue }
            if ini.insi_laddr.ina_46.i46a_addr4.s_addr == loopback { return true }
        }
        return false
    }
}
