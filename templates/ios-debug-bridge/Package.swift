// swift-tools-version:5.9
// Make It Ship iOS debug bridge (M5). DEBUG builds only: every source is wrapped in `#if DEBUG`,
// so a Release build contains none of it. Remove it before shipping: see README.md.
import PackageDescription

let package = Package(
    name: "DebugBridge",
    platforms: [.iOS(.v16)],
    products: [.library(name: "DebugBridge", targets: ["DebugBridge"])],
    targets: [
        .target(name: "DebugBridge", swiftSettings: [.define("DEBUG", .when(configuration: .debug))])
    ]
)
