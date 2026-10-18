// The pure logic of the ReplayEncoder module: config resolution, frame timing, file paths, fit rectangles, and the Android-only raw header and
// RGBA->YUV conversion. Foundation only, so EncoderLogicTests compiles it on Linux. Mirrors the Kotlin files of the same names in
// ../android/src/main/java/com/joyodigitama/replayencoder (EncoderConfig, FrameTiming, RawFrame, FitRect, Yuv); keep them in step. iOS itself only
// calls the config, path, timing, sequencer and fit parts; RawFrameHeader and Yuv exist so both platforms are tested against the same numbers.
import Foundation

/// The codes of `EncoderErrorCode` in ReplayEncoder.types.ts.
enum EncoderErrorCode: String {
    case unsupported = "ERR_ENCODER_UNSUPPORTED"
    case config = "ERR_ENCODER_CONFIG"
    case frame = "ERR_ENCODER_FRAME"
    case state = "ERR_ENCODER_STATE"
    case io = "ERR_ENCODER_IO"
}

/// A failure that reaches JS as a rejection with `code`.
struct EncoderError: Error, Equatable {
    let code: EncoderErrorCode
    let message: String

    init(_ code: EncoderErrorCode, _ message: String) {
        self.code = code
        self.message = message
    }
}

/// A validated encoder configuration. Build it with `resolve`.
struct EncoderConfig: Equatable {
    let width: Int
    let height: Int
    let fps: Int
    let bitrate: Int

    static let minSize = 16
    static let maxSize = 4096
    static let minFps = 1
    static let maxFps = 60
    static let bitsPerPixel = 0.11
    static let minBitrate = 1_000_000
    static let maxBitrate = 20_000_000

    /// round(width * height * fps * 0.11), clamped to 1..20 Mbps.
    static func defaultBitrate(width: Int, height: Int, fps: Int) -> Int {
        clampBitrate((Double(width) * Double(height) * Double(fps) * bitsPerPixel).rounded())
    }

    /// Validates the values JS sent (numbers arrive as doubles) and fills in the bitrate. Throws ERR_ENCODER_CONFIG for a non-integer,
    /// non-finite, out-of-range or odd size, a bad fps, or a non-positive bitrate.
    static func resolve(width: Double, height: Double, fps: Double, bitrate: Double?) throws -> EncoderConfig {
        let w = try integer("width", width)
        let h = try integer("height", height)
        let f = try integer("fps", fps)
        guard (minSize...maxSize).contains(w) else { throw fail("width must be \(minSize)..\(maxSize), got \(w)") }
        guard (minSize...maxSize).contains(h) else { throw fail("height must be \(minSize)..\(maxSize), got \(h)") }
        guard w % 2 == 0 else { throw fail("width must be even, got \(w)") }
        guard h % 2 == 0 else { throw fail("height must be even, got \(h)") }
        guard (minFps...maxFps).contains(f) else { throw fail("fps must be \(minFps)..\(maxFps), got \(f)") }
        let rate: Int
        if let bitrate = bitrate {
            guard bitrate.isFinite, bitrate > 0 else { throw fail("bitrate must be a positive number, got \(bitrate)") }
            rate = clampBitrate(bitrate.rounded())
        } else {
            rate = defaultBitrate(width: w, height: h, fps: f)
        }
        return EncoderConfig(width: w, height: h, fps: f, bitrate: rate)
    }

    private static func clampBitrate(_ value: Double) -> Int {
        Int(min(max(value, Double(minBitrate)), Double(maxBitrate)))
    }

    private static func integer(_ name: String, _ value: Double) throws -> Int {
        guard value.isFinite, value == value.rounded(.towardZero), abs(value) <= Double(Int32.max) else {
            throw fail("\(name) must be an integer, got \(value)")
        }
        return Int(value)
    }

    private static func fail(_ message: String) -> EncoderError {
        EncoderError(.config, message)
    }
}

/// `file://` URIs and plain paths of the files JS hands over.
enum FilePaths {
    /// `file:///a%20b/c.mp4` -> `/a b/c.mp4`; an absolute path passes through. Anything else is rejected with `code`.
    static func fromUri(_ value: String, code: EncoderErrorCode) throws -> String {
        let raw = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let path: String
        if raw.hasPrefix("file://") {
            var rest = String(raw.dropFirst("file://".count))
            if let cut = rest.firstIndex(where: { $0 == "?" || $0 == "#" }) { rest = String(rest[..<cut]) }
            path = decode(rest)
        } else if raw.hasPrefix("/") {
            path = raw
        } else {
            throw EncoderError(code, "Not a file:// URI or absolute path: \(value)")
        }
        guard path.hasPrefix("/"), !path.hasSuffix("/") else { throw EncoderError(code, "Not a file path: \(value)") }
        return path
    }

    /// Percent-decoding of UTF-8 sequences; a stray `%` stays as it is, `+` is not a space.
    private static func decode(_ text: String) -> String {
        let bytes = Array(text.utf8)
        guard bytes.contains(UInt8(ascii: "%")) else { return text }
        var out: [UInt8] = []
        out.reserveCapacity(bytes.count)
        var i = 0
        while i < bytes.count {
            if bytes[i] == UInt8(ascii: "%"), i + 2 < bytes.count, let hi = hex(bytes[i + 1]), let lo = hex(bytes[i + 2]) {
                out.append(UInt8(hi * 16 + lo))
                i += 3
            } else {
                out.append(bytes[i])
                i += 1
            }
        }
        return String(decoding: out, as: UTF8.self)
    }

    private static func hex(_ byte: UInt8) -> Int? {
        switch byte {
        case UInt8(ascii: "0")...UInt8(ascii: "9"): return Int(byte) - Int(UInt8(ascii: "0"))
        case UInt8(ascii: "a")...UInt8(ascii: "f"): return Int(byte) - Int(UInt8(ascii: "a")) + 10
        case UInt8(ascii: "A")...UInt8(ascii: "F"): return Int(byte) - Int(UInt8(ascii: "A")) + 10
        default: return nil
        }
    }
}

/// Presentation times, always computed from the integer frame index so nothing drifts.
enum FrameClock {
    /// index * 1_000_000 / fps microseconds, rounded down. 30 fps gives 0, 33_333, 66_666, 100_000, ...
    static func ptsUs(index: Int64, fps: Int) -> Int64 {
        index * 1_000_000 / Int64(fps)
    }

    /// Length of `frames` frames at `fps`, rounded down to a millisecond.
    static func durationMs(frames: Int64, fps: Int) -> Int64 {
        frames * 1_000 / Int64(fps)
    }
}

/// Accepts the frame indexes 0, 1, 2, ... in order and nothing else.
struct FrameSequencer {
    /// The index the next frame must have, which is also the number of frames accepted so far.
    private(set) var expected: Int = 0

    /// Throws ERR_ENCODER_FRAME for a gap or a repeat; does not advance.
    func check(_ index: Int) throws {
        guard index != expected else { return }
        let what = index < expected ? "repeated or out of order" : "skips ahead"
        throw EncoderError(.frame, "Frame index \(index) is \(what); expected \(expected)")
    }

    /// Counts the frame `check` approved.
    mutating func advance() {
        expected += 1
    }
}

/// The rectangle a scaled source covers in destination pixels. `left` and `top` are negative when the source overflows.
struct FitRect: Equatable {
    enum Mode {
        /// Scale to fill the destination and crop the overflow.
        case cover
        /// Scale to fit inside the destination and leave bars.
        case contain
    }

    let left: Int
    let top: Int
    let width: Int
    let height: Int

    /// Where a `srcW`x`srcH` source lands in a `dstW`x`dstH` destination, centred, with integer math only.
    static func fit(srcW: Int, srcH: Int, dstW: Int, dstH: Int, mode: Mode) -> FitRect {
        precondition(srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0, "sizes must be positive")
        // Compare aspect ratios without division: src wider than dst <=> srcW/srcH > dstW/dstH.
        let srcIsWider = srcW * dstH > srcH * dstW
        let matchHeight = mode == .cover ? srcIsWider : !srcIsWider
        var w: Int
        var h: Int
        if matchHeight {
            h = dstH
            w = divide(srcW * dstH, srcH, mode)
        } else {
            w = dstW
            h = divide(srcH * dstW, srcW, mode)
        }
        if mode == .contain {
            w = min(max(w, 1), dstW)
            h = min(max(h, 1), dstH)
        }
        // `>> 1` is a floor division by two, also for the negative offsets of cover.
        return FitRect(left: (dstW - w) >> 1, top: (dstH - h) >> 1, width: w, height: h)
    }

    /// Cover rounds up so no edge is left bare; contain rounds to nearest.
    private static func divide(_ n: Int, _ d: Int, _ mode: Mode) -> Int {
        mode == .cover ? (n + d - 1) / d : (n + d / 2) / d
    }
}

/// The header of a react-native-view-shot "raw" file: ASCII `<width>:<height>|`, then width * height * 4 bytes in Android ARGB_8888 memory
/// order (R, G, B, A, premultiplied). Android only.
struct RawFrameHeader: Equatable {
    let width: Int
    let height: Int
    let payloadOffset: Int

    static let bytesPerPixel = 4
    static let maxDimension = 8192
    static let maxPixels = 4096 * 4096
    /// The longest valid header: five digits, ':', five digits, '|'.
    static let maxHeaderBytes = 12

    /// The byte count the payload must have.
    var payloadBytes: Int { width * height * RawFrameHeader.bytesPerPixel }

    /// Rejects a file whose length is not exactly header + payload (truncated write, wrong file).
    func checkFileLength(_ fileLength: Int) throws {
        let expected = payloadOffset + payloadBytes
        guard fileLength == expected else {
            throw EncoderError(.frame, "Raw frame is \(fileLength) bytes, a \(width)x\(height) frame needs \(expected)")
        }
    }

    /// Parses the header from the first `length` bytes of the file. Throws ERR_ENCODER_FRAME when it is malformed.
    static func parse(_ bytes: [UInt8], length: Int? = nil) throws -> RawFrameHeader {
        let limit = min(length ?? bytes.count, bytes.count, maxHeaderBytes)
        var i = 0
        let width = try number(bytes, &i, limit)
        guard i < limit, bytes[i] == UInt8(ascii: ":") else { throw malformed("expected ':' after the width") }
        i += 1
        let height = try number(bytes, &i, limit)
        guard i < limit, bytes[i] == UInt8(ascii: "|") else { throw malformed("expected '|' after the height") }
        guard width >= 1, height >= 1, width <= maxDimension, height <= maxDimension, width * height <= maxPixels else {
            throw malformed("size \(width)x\(height) is out of range")
        }
        return RawFrameHeader(width: width, height: height, payloadOffset: i + 1)
    }

    /// Reads the decimal digits at `i` and leaves `i` after the last one.
    private static func number(_ bytes: [UInt8], _ i: inout Int, _ limit: Int) throws -> Int {
        let start = i
        var value = 0
        while i < limit, bytes[i] >= UInt8(ascii: "0"), bytes[i] <= UInt8(ascii: "9") {
            value = value * 10 + Int(bytes[i] - UInt8(ascii: "0"))
            guard value <= maxDimension else { throw malformed("number too large") }
            i += 1
        }
        guard i > start else { throw malformed("expected digits") }
        return value
    }

    private static func malformed(_ why: String) -> EncoderError {
        EncoderError(.frame, "Malformed raw frame header: \(why)")
    }
}

/// RGBA to YUV 4:2:0, BT.709, limited (studio) range: Y 16..235, Cb and Cr 16..240. Fixed point with 16 fractional bits and round-to-nearest.
/// The Cb and Cr coefficient rows sum to zero, so every grey maps to exactly 128. Android only.
enum Yuv {
    private static let yR = 11966  // 0.2126 * 219 / 255
    private static let yG = 40254  // 0.7152 * 219 / 255
    private static let yB = 4064  // 0.0722 * 219 / 255
    private static let uR = -6596
    private static let uG = -22189
    private static let uB = 28785  // 0.5 * 224 / 255
    private static let vR = 28785
    private static let vG = -26145
    private static let vB = -2640

    private static let yOffset = (16 << 16) + 32768
    private static let cOffset = (128 << 16) + 32768
    /// Chroma of a 2x2 block is computed on the sum of four pixels, so the shift is 18 instead of 16.
    private static let cOffsetSum4 = (128 << 18) + (1 << 17)

    /// Y of one pixel, 16..235.
    static func y(_ r: Int, _ g: Int, _ b: Int) -> Int { (yR * r + yG * g + yB * b + yOffset) >> 16 }

    /// Cb of one pixel, 16..240.
    static func u(_ r: Int, _ g: Int, _ b: Int) -> Int { (uR * r + uG * g + uB * b + cOffset) >> 16 }

    /// Cr of one pixel, 16..240.
    static func v(_ r: Int, _ g: Int, _ b: Int) -> Int { (vR * r + vG * g + vB * b + cOffset) >> 16 }

    /// Luma of `width` pixels of an RGBA row starting at byte `offset` of `rgba`, into out[0..<width].
    static func lumaRow(_ rgba: [UInt8], offset: Int, width: Int, into out: inout [UInt8]) {
        var src = offset
        for x in 0..<width {
            out[x] = UInt8(y(Int(rgba[src]), Int(rgba[src + 1]), Int(rgba[src + 2])))
            src += 4
        }
    }

    /// One row of chroma from two RGBA rows: the first starts at byte `topOffset`, the second `rowBytes` later. Every sample is the mean of
    /// a 2x2 block, so `outU` and `outV` get width / 2 values.
    static func chromaRow(_ rgba: [UInt8], topOffset: Int, rowBytes: Int, width: Int, outU: inout [UInt8], outV: inout [UInt8]) {
        var top = topOffset
        var bottom = topOffset + rowBytes
        for x in 0..<(width / 2) {
            let r = Int(rgba[top]) + Int(rgba[top + 4]) + Int(rgba[bottom]) + Int(rgba[bottom + 4])
            let g = Int(rgba[top + 1]) + Int(rgba[top + 5]) + Int(rgba[bottom + 1]) + Int(rgba[bottom + 5])
            let b = Int(rgba[top + 2]) + Int(rgba[top + 6]) + Int(rgba[bottom + 2]) + Int(rgba[bottom + 6])
            outU[x] = UInt8((uR * r + uG * g + uB * b + cOffsetSum4) >> 18)
            outV[x] = UInt8((vR * r + vG * g + vB * b + cOffsetSum4) >> 18)
            top += 8
            bottom += 8
        }
    }
}
