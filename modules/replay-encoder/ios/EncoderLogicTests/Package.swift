// swift-tools-version:5.9
import PackageDescription

// Logic tests for the pure part of the iOS ReplayEncoder module (EncoderMath.swift), runnable on Linux and macOS.
// The target's only source is a symlink to ../../EncoderMath.swift: the file the CocoaPods pod compiles.
let package = Package(
    name: "EncoderLogicTests",
    platforms: [.iOS(.v15), .macOS(.v12)],
    targets: [
        .target(name: "EncoderLogic"),
        .testTarget(name: "EncoderLogicTests", dependencies: ["EncoderLogic"]),
    ]
)
