import Foundation
import SystemExtensions
import NetworkExtension

/// Container app for the Wrapbox transparent proxy system extension.
///
/// SAFETY: this app does NOTHING unless explicitly told to. Running it with no
/// arguments only prints status. Activation is a real system change — it asks
/// the user for approval in System Settings and, once approved, routes traffic
/// for every app on the Mac — so it is never a side effect of launching.
///
///   WrapboxApp                 show status, change nothing   (default)
///   WrapboxApp activate        request installation of the system extension
///   WrapboxApp deactivate      request removal
final class Controller: NSObject, OSSystemExtensionRequestDelegate {

    private let extensionIdentifier = "io.wrapbox.WrapboxProxy.extension"

    func activate() {
        let r = OSSystemExtensionRequest.activationRequest(
            forExtensionWithIdentifier: extensionIdentifier, queue: .main)
        r.delegate = self
        OSSystemExtensionManager.shared.submitRequest(r)
        print("submitted activation request for \(extensionIdentifier)")
        print("macOS will ask you to approve it in System Settings > General > Login Items & Extensions.")
    }

    func deactivate() {
        let r = OSSystemExtensionRequest.deactivationRequest(
            forExtensionWithIdentifier: extensionIdentifier, queue: .main)
        r.delegate = self
        OSSystemExtensionManager.shared.submitRequest(r)
        print("submitted deactivation request for \(extensionIdentifier)")
    }

    // MARK: OSSystemExtensionRequestDelegate

    func request(_ request: OSSystemExtensionRequest,
                 actionForReplacingExtension existing: OSSystemExtensionProperties,
                 withExtension ext: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplacementAction {
        print("replacing build \(existing.bundleVersion) with \(ext.bundleVersion)")
        return .replace
    }

    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        print("awaiting your approval in System Settings — nothing is active until you approve.")
    }

    func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) {
        print("request finished: \(result.rawValue)")
        exit(0)
    }

    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) {
        FileHandle.standardError.write(Data("request failed: \(error.localizedDescription)\n".utf8))
        exit(1)
    }
}

let controller = Controller()
switch CommandLine.arguments.dropFirst().first {
case "activate":
    controller.activate()
    RunLoop.main.run()
case "deactivate":
    controller.deactivate()
    RunLoop.main.run()
default:
    print("Wrapbox proxy extension container")
    print("  bundle: io.wrapbox.WrapboxProxy")
    print("  extension: io.wrapbox.WrapboxProxy.extension")
    print("  daemon target: 127.0.0.1:4180")
    print("")
    print("No change made. Use 'activate' to request installation (asks for approval),")
    print("or 'deactivate' to remove it.")
}
