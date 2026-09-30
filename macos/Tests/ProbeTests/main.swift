import Darwin
// argv: pid port expected(true/false) label
let a = CommandLine.arguments
let got = ProcessSocketProbe.ownsLoopbackListener(pid: pid_t(a[1])!, port: UInt16(a[2])!)
let want = a[3] == "true"
print("  \(got == want ? "PASS" : "FAIL")  \(a[4]): got=\(got) want=\(want)")
// audit token of THIS process -> pid, via libbsm, must equal getpid()
var tok = audit_token_t(); var sz = mach_msg_type_number_t(MemoryLayout<audit_token_t>.size / MemoryLayout<natural_t>.size)
let kr = withUnsafeMutablePointer(to: &tok) { p in p.withMemoryRebound(to: integer_t.self, capacity: Int(sz)) { task_info(mach_task_self_, task_flavor_t(TASK_AUDIT_TOKEN), $0, &sz) } }
if a[4].hasPrefix("A") { print("  \(kr == KERN_SUCCESS && audit_token_to_pid(tok) == getpid() ? "PASS" : "FAIL")  audit_token_to_pid(own token) == getpid(): \(audit_token_to_pid(tok)) vs \(getpid()), pidversion=\(audit_token_to_pidversion(tok))") }
