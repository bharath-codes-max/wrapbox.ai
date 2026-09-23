import Foundation
import NetworkExtension

// A NetworkExtension system extension is started by the system, which reads
// NEProviderClasses from Info.plist to find the provider. This call parks the
// process on the run loop and never returns.
autoreleasepool {
    NEProvider.startSystemExtensionMode()
}
dispatchMain()
