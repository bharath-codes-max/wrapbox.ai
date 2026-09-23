#!/usr/bin/env bash
# Unit tests for the Wrapbox Network Extension — no activation, no system change.
# Every suite runs against the SAME source files the Xcode targets compile.
#   macos/Tests/run-tests.sh
set -uo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
OUT=$(mktemp -d); trap 'rm -rf "$OUT"; kill $(jobs -p) 2>/dev/null' EXIT
SC="xcrun swiftc -O -target arm64-apple-macos15.0"
total_fail=0
suite() { echo; echo "══════ $1 ══════"; }
record() { [ "$1" -eq 0 ] || total_fail=$((total_fail+1)); }

suite "SNI parser vs a REAL OpenSSL ClientHello"
python3 - "$OUT/hello.bin" <<'PY' &
import socket, sys
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(("127.0.0.1",47653)); s.listen(1)
c,_=s.accept(); open(sys.argv[1],"wb").write(c.recv(8192)); c.close()
PY
sleep 0.5; openssl s_client -connect 127.0.0.1:47653 -servername chatgpt.com </dev/null >/dev/null 2>&1; wait
$SC WrapboxProxyExtension/SNISniffer.swift Tests/SNITests/main.swift -o "$OUT/sni" && "$OUT/sni" "$OUT/hello.bin"; record $?

suite "Policy + rules + daemon identity (fixes A, B, E)"
$SC Shared/FlowPolicy.swift Shared/DaemonIdentity.swift Shared/ProcessSocketProbe.swift Tests/PolicyTests/main.swift -lbsm -o "$OUT/policy" && "$OUT/policy"; record $?

suite "Listener-ownership probe vs real processes (fix B)"
$SC Shared/ProcessSocketProbe.swift Tests/ProbeTests/main.swift -lbsm -o "$OUT/probe" || record 1
python3 -c "
import socket,time,os
a=socket.socket(); a.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); a.bind(('127.0.0.1',47654)); a.listen(5)
b=socket.socket(); b.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); b.bind(('0.0.0.0',47655)); b.listen(5)
open('$OUT/lpid','w').write(str(os.getpid())); time.sleep(20)" &
sleep 1; LPID=$(cat "$OUT/lpid")
python3 -c "
import socket,time,os; s=socket.create_connection(('127.0.0.1',47654)); open('$OUT/cpid','w').write(str(os.getpid())); time.sleep(15)" &
sleep 1; CPID=$(cat "$OUT/cpid"); sleep 30 & SPID=$!
p=0
"$OUT/probe" $LPID 47654 true  "listener on 127.0.0.1 (the daemon case)" || p=1
"$OUT/probe" $LPID 47999 false "same process, other port" || p=1
"$OUT/probe" $LPID 47655 false "listener on 0.0.0.0 (not loopback)" || p=1
"$OUT/probe" $CPID 47654 false "a CLIENT connected to the listener" || p=1
"$OUT/probe" $SPID 47654 false "process with no sockets" || p=1
"$OUT/probe" 99999 47654 false "non-existent pid" || p=1
"$OUT/probe" 1 47654 false "launchd (pid 1)" || p=1
out=$("$OUT/probe" 1 47654 false "own-token check" ; "$OUT/probe" $$ 47654 false "A: audit token -> pid"); echo "$out" | tail -1
echo "$out" | grep -q FAIL && p=1
record $p

suite "DaemonDialer vs fake daemons (fix C: bounded, never hangs)"
$SC Shared/DaemonDialer.swift Tests/DialerTests/main.swift -o "$OUT/dial" || record 1
python3 Tests/DialerTests/fake_daemon.py "$OUT" & sleep 1.5
"$OUT/dial"; record $?

echo; echo "══════════════════════════════"
[ $total_fail -eq 0 ] && echo "ALL SUITES PASSED" || echo "$total_fail SUITE(S) FAILED"
exit $total_fail
