// The AVAssetWriter side of the ReplayEncoder module: one MP4 session at a time, frames decoded with ImageIO and drawn into BGRA pixel buffers
// from the adaptor's pool. Everything runs inside this actor, never on the main thread; the only suspension is the back-pressure wait.
#if canImport(AVFoundation) && canImport(ImageIO)
import AVFoundation
import CoreGraphics
import CoreMedia
import CoreVideo
import Foundation
import ImageIO

struct EncoderSessionInfo {
    let id: String
    let width: Int
    let height: Int
    let fps: Int
    let bitrate: Int
    let path: String
}

struct EncoderOutcome {
    let uri: String
    let bytes: Int64
    let frames: Int64
    let durationMs: Int64
}

actor EncoderEngine {
    private final class Session {
        let id = UUID().uuidString
        let config: EncoderConfig
        let path: String
        let url: URL
        let writer: AVAssetWriter
        let input: AVAssetWriterInput
        let adaptor: AVAssetWriterInputPixelBufferAdaptor
        var sequencer = FrameSequencer()
        /// An `appendFrame` is between its checks and its append; a second one is a caller bug.
        var busy = false
        /// `finish` was accepted: no more frames.
        var closing = false
        /// `finishWriting` is running; the writer can no longer be cancelled, so `finish` cleans up when it returns.
        var finishCalled = false
        var cancelled = false

        init(config: EncoderConfig, path: String, url: URL, writer: AVAssetWriter, input: AVAssetWriterInput, adaptor: AVAssetWriterInputPixelBufferAdaptor) {
            self.config = config
            self.path = path
            self.url = url
            self.writer = writer
            self.input = input
            self.adaptor = adaptor
        }
    }

    /// A session that makes no progress for this long is dead (the hardware encoder crashed or the writer failed silently).
    private static let stallNs: UInt64 = 20_000_000_000
    private static let pollNs: UInt64 = 3_000_000

    private var active: Session?

    func support() -> [String: Any] {
        ["available": true, "h264": true, "maxWidth": EncoderConfig.maxSize, "maxHeight": EncoderConfig.maxSize]
    }

    func begin(path: String, width: Double, height: Double, fps: Double, bitrate: Double?) throws -> EncoderSessionInfo {
        let config = try EncoderConfig.resolve(width: width, height: height, fps: fps, bitrate: bitrate)
        let url = URL(fileURLWithPath: try FilePaths.fromUri(path, code: .config))
        guard active == nil else { throw EncoderError(.state, "An encoder session is already active") }

        let fileManager = FileManager.default
        do {
            try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            if fileManager.fileExists(atPath: url.path) { try fileManager.removeItem(at: url) }
        } catch {
            throw EncoderError(.io, "Cannot prepare \(url.path): \(error.localizedDescription)")
        }

        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: config.width,
            AVVideoHeightKey: config.height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: config.bitrate,
                AVVideoMaxKeyFrameIntervalKey: config.fps,
                AVVideoExpectedSourceFrameRateKey: config.fps,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            ] as [String: Any],
        ]
        let writer: AVAssetWriter
        do {
            writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        } catch {
            throw EncoderError(.io, "Cannot create \(url.path): \(error.localizedDescription)")
        }
        guard writer.canApply(outputSettings: settings, forMediaType: .video) else {
            throw EncoderError(.unsupported, "The H.264 encoder does not accept \(config.width)x\(config.height)")
        }
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = false
        // fps * 1000 holds every CMTime(value: index, timescale: fps) exactly, so the file carries no rounding of its own.
        input.mediaTimeScale = CMTimeScale(config.fps * 1000)
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: config.width,
                kCVPixelBufferHeightKey as String: config.height,
            ])
        guard writer.canAdd(input) else { throw EncoderError(.unsupported, "The MP4 writer rejected the video input") }
        writer.add(input)
        guard writer.startWriting() else {
            try? fileManager.removeItem(at: url)
            throw EncoderError(.io, "Cannot start writing \(url.path): \(writer.error?.localizedDescription ?? "unknown error")")
        }
        writer.startSession(atSourceTime: .zero)

        let session = Session(config: config, path: path, url: url, writer: writer, input: input, adaptor: adaptor)
        active = session
        return EncoderSessionInfo(id: session.id, width: config.width, height: config.height, fps: config.fps, bitrate: config.bitrate, path: path)
    }

    func appendFrame(id: String, frameUri: String, index: Double) async throws {
        let session = try find(id)
        guard !session.closing else { throw EncoderError(.state, "The encoder session is finishing") }
        guard index >= 0, index == index.rounded(.towardZero), index <= Double(Int32.max) else {
            throw EncoderError(.frame, "Frame index must be a non-negative integer, got \(index)")
        }
        let framePath = try FilePaths.fromUri(frameUri, code: .frame)
        guard !framePath.lowercased().hasSuffix(".raw") else {
            throw EncoderError(.frame, "Raw frames exist on Android only; send a PNG, JPEG or WEBP")
        }
        guard !session.busy else { throw EncoderError(.state, "An appendFrame call is already in flight") }
        session.busy = true
        defer { session.busy = false }

        do {
            try session.sequencer.check(Int(index))
            let buffer = try render(URL(fileURLWithPath: framePath), into: session)
            try await waitUntilReady(session)
            guard !session.cancelled else { throw EncoderError(.state, "The encoder session was cancelled") }
            let time = CMTime(value: CMTimeValue(index), timescale: CMTimeScale(session.config.fps))
            guard session.adaptor.append(buffer, withPresentationTime: time) else {
                throw EncoderError(.io, "The MP4 writer refused frame \(Int(index)): \(session.writer.error?.localizedDescription ?? "unknown error")")
            }
            session.sequencer.advance()
        } catch let error as EncoderError where error.code == .frame {
            // A bad frame or index leaves the session consistent; the caller may retry.
            throw error
        } catch let error as EncoderError {
            teardown(session)
            throw error
        } catch {
            teardown(session)
            throw EncoderError(.io, error.localizedDescription)
        }
    }

    func finish(id: String) async throws -> EncoderOutcome {
        let session = try find(id)
        guard !session.closing else { throw EncoderError(.state, "The encoder session is already finishing") }
        session.closing = true
        let frames = Int64(session.sequencer.expected)
        guard frames > 0 else {
            teardown(session)
            throw EncoderError(.state, "No frame was appended")
        }
        session.input.markAsFinished()
        let writer = session.writer
        session.finishCalled = true
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            writer.finishWriting { continuation.resume() }
        }
        guard !session.cancelled else {
            teardown(session)
            throw EncoderError(.state, "The encoder session was cancelled")
        }
        guard writer.status == .completed else {
            let reason = writer.error?.localizedDescription ?? "status \(writer.status.rawValue)"
            teardown(session)
            throw EncoderError(.io, "The MP4 writer failed: \(reason)")
        }
        if active === session { active = nil }
        let size = (try? FileManager.default.attributesOfItem(atPath: session.url.path)[.size] as? NSNumber)?.int64Value ?? 0
        return EncoderOutcome(
            uri: session.url.absoluteString, bytes: size, frames: frames, durationMs: FrameClock.durationMs(frames: frames, fps: session.config.fps))
    }

    func cancel(id: String) {
        guard let session = active, session.id == id else { return }
        requestCancel(session)
    }

    func cancelActive() {
        if let session = active { requestCancel(session) }
    }

    private func requestCancel(_ session: Session) {
        if session.finishCalled {
            session.cancelled = true
        } else {
            teardown(session)
        }
    }

    private func find(_ id: String) throws -> Session {
        guard let session = active, session.id == id else {
            throw EncoderError(.state, "Unknown or finished encoder session: \(id)")
        }
        return session
    }

    /// Stops the writer, deletes the partial file and lets a new session begin. Idempotent; an `appendFrame` suspended in its wait sees `cancelled`.
    private func teardown(_ session: Session) {
        session.cancelled = true
        if active === session { active = nil }
        if session.writer.status == .writing { session.writer.cancelWriting() }
        try? FileManager.default.removeItem(at: session.url)
    }

    /// The back-pressure: suspends (without holding a thread) until the writer can take another frame.
    private func waitUntilReady(_ session: Session) async throws {
        var waited: UInt64 = 0
        while !session.input.isReadyForMoreMediaData {
            if session.cancelled { throw EncoderError(.state, "The encoder session was cancelled") }
            if session.writer.status == .failed {
                throw EncoderError(.io, "The MP4 writer failed: \(session.writer.error?.localizedDescription ?? "unknown error")")
            }
            if waited > Self.stallNs { throw EncoderError(.io, "The encoder stopped taking frames") }
            try await Task.sleep(nanoseconds: Self.pollNs)
            waited += Self.pollNs
        }
        if session.cancelled { throw EncoderError(.state, "The encoder session was cancelled") }
        if session.writer.status == .failed {
            throw EncoderError(.io, "The MP4 writer failed: \(session.writer.error?.localizedDescription ?? "unknown error")")
        }
    }

    /// Decodes the image file and draws it, scaled to fill, into a fresh pixel buffer of the adaptor's pool.
    private func render(_ url: URL, into session: Session) throws -> CVPixelBuffer {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), CGImageSourceGetCount(source) > 0,
            let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: false] as CFDictionary)
        else {
            throw EncoderError(.frame, "Not a decodable PNG, JPEG or WEBP image: \(url.lastPathComponent)")
        }
        guard let pool = session.adaptor.pixelBufferPool else {
            throw EncoderError(.io, "The MP4 writer has no pixel buffer pool")
        }
        var created: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &created) == kCVReturnSuccess, let buffer = created else {
            throw EncoderError(.io, "Cannot allocate a pixel buffer")
        }
        let width = session.config.width
        let height = session.config.height
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let base = CVPixelBufferGetBaseAddress(buffer),
            let context = CGContext(
                data: base, width: width, height: height, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        else {
            throw EncoderError(.io, "Cannot draw into the pixel buffer")
        }
        context.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.interpolationQuality = .high
        let fit = FitRect.fit(srcW: image.width, srcH: image.height, dstW: width, dstH: height, mode: .cover)
        // Core Graphics counts y from the bottom; the fit rectangle counts from the top.
        context.draw(image, in: CGRect(x: fit.left, y: height - fit.top - fit.height, width: fit.width, height: fit.height))
        return buffer
    }
}
#endif
