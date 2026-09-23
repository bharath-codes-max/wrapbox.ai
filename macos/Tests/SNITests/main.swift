import Foundation
let path = CommandLine.arguments[1]
let data = try! Data(contentsOf: URL(fileURLWithPath: path))

func check(_ name: String, _ got: String?, _ want: String?) {
    let ok = got == want
    print("  \(ok ? "PASS" : "FAIL")  \(name.padding(toLength: 42, withPad: " ", startingAt: 0)) got=\(got ?? "nil")")
}
// 1. real ClientHello from OpenSSL, SNI = chatgpt.com
check("real OpenSSL ClientHello", SNISniffer.hostname(in: data), "chatgpt.com")
// 2. truncated record must not crash and must return nil
check("truncated (first 20 bytes)", SNISniffer.hostname(in: data.prefix(20)), nil)
check("truncated (first 5 bytes)", SNISniffer.hostname(in: data.prefix(5)), nil)
check("empty", SNISniffer.hostname(in: Data()), nil)
// 3. plain HTTP must return nil, not garbage
check("plain HTTP request", SNISniffer.hostname(in: Data("GET / HTTP/1.1\r\nHost: x.com\r\n\r\n".utf8)), nil)
// 4. random bytes must not crash
var rng = SystemRandomNumberGenerator()
let junk = Data((0..<2000).map { _ in UInt8.random(in: 0...255, using: &rng) })
_ = SNISniffer.hostname(in: junk)
print("  PASS  random-bytes fuzz did not crash")
// 5. a record claiming handshake but lying about lengths
var evil = Data([0x16, 0x03, 0x01, 0xFF, 0xFF, 0x01, 0xFF, 0xFF, 0xFF])
evil.append(Data(repeating: 0x41, count: 50))
_ = SNISniffer.hostname(in: evil)
print("  PASS  malformed-length record did not crash")
