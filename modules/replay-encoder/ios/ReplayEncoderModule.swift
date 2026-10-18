// Expo module `ReplayEncoder` for iOS: the JS API of src/ReplayEncoder.ts. The work lives in the EncoderEngine actor; this file converts the
// arguments and the pure EncoderError into the coded exception JS sees.
#if canImport(ExpoModulesCore) && canImport(AVFoundation)
import ExpoModulesCore
import Foundation

/// A failure that reaches JS as a coded exception (`ERR_ENCODER_...` is the code on the JS error).
final class ReplayEncoderException: Exception, @unchecked Sendable {
    init(_ code: String, _ message: String, file: String = #fileID, line: UInt = #line, function: String = #function) {
        super.init(name: "ReplayEncoderException", description: message, code: code, file: file, line: line, function: function)
    }
}

/// Runs `body` and turns the pure `EncoderError` into the coded exception JS sees.
private func encoderCall<T>(_ body: () async throws -> T) async throws -> T {
    do {
        return try await body()
    } catch let error as EncoderError {
        throw ReplayEncoderException(error.code.rawValue, error.message)
    }
}

/// JS numbers arrive as Int or Double depending on their value.
private func number(_ value: Any?) -> Double? {
    switch value {
    case let double as Double: return double
    case let int as Int: return Double(int)
    case let number as NSNumber: return number.doubleValue
    default: return nil
    }
}

public final class ReplayEncoderModule: Module {
    public func definition() -> ModuleDefinition {
        let engine = EncoderEngine()

        Name("ReplayEncoder")

        // A JS reload must not leave a writer and a half-written file behind.
        OnDestroy {
            Task { await engine.cancelActive() }
        }

        AsyncFunction("getSupport") { () async -> [String: Any] in
            await engine.support()
        }

        AsyncFunction("begin") { (config: [String: Any]) async throws -> [String: Any] in
            try await encoderCall { () async throws -> [String: Any] in
                guard let path = config["path"] as? String else { throw EncoderError(.config, "path must be a string") }
                guard let width = number(config["width"]), let height = number(config["height"]), let fps = number(config["fps"]) else {
                    throw EncoderError(.config, "width, height and fps must be numbers")
                }
                let session = try await engine.begin(path: path, width: width, height: height, fps: fps, bitrate: number(config["bitrate"]))
                return [
                    "id": session.id, "width": session.width, "height": session.height, "fps": session.fps, "bitrate": session.bitrate,
                    "path": session.path,
                ]
            }
        }

        AsyncFunction("appendFrame") { (id: String, frameUri: String, index: Double) async throws -> Void in
            try await encoderCall { try await engine.appendFrame(id: id, frameUri: frameUri, index: index) }
        }

        AsyncFunction("finish") { (id: String) async throws -> [String: Any] in
            try await encoderCall { () async throws -> [String: Any] in
                let result = try await engine.finish(id: id)
                return ["uri": result.uri, "bytes": Double(result.bytes), "frames": Double(result.frames), "durationMs": Double(result.durationMs)]
            }
        }

        AsyncFunction("cancel") { (id: String) async -> Void in
            await engine.cancel(id: id)
        }
    }
}
#endif
