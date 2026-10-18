// swift-tools-version:5.9
import PackageDescription

// Logic tests for the pure part of the iOS BleSensors module (SensorProfile.swift), runnable on Linux and macOS.
// The target's only source is a symlink to ../../SensorProfile.swift: the file the CocoaPods pod compiles.
let package = Package(
    name: "SensorLogicTests",
    platforms: [.iOS(.v15), .macOS(.v12)],
    targets: [
        .target(name: "SensorLogic"),
        .testTarget(name: "SensorLogicTests", dependencies: ["SensorLogic"]),
    ]
)
