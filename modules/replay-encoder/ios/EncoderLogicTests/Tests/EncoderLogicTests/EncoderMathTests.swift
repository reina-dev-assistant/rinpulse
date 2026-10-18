import XCTest

@testable import EncoderLogic

final class EncoderConfigTests: XCTestCase {
    private func assertRejected(
        width: Double = 1080, height: Double = 1920, fps: Double = 30, bitrate: Double? = nil,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        XCTAssertThrowsError(try EncoderConfig.resolve(width: width, height: height, fps: fps, bitrate: bitrate), file: file, line: line) { error in
            XCTAssertEqual((error as? EncoderError)?.code, .config, file: file, line: line)
        }
    }

    func testTheDefaultBitrateIsElevenHundredthsOfABitPerPixel() throws {
        let config = try EncoderConfig.resolve(width: 1080, height: 1920, fps: 30, bitrate: nil)
        XCTAssertEqual(config, EncoderConfig(width: 1080, height: 1920, fps: 30, bitrate: 6_842_880))
    }

    func testTheDefaultBitrateIsClamped() {
        XCTAssertEqual(EncoderConfig.defaultBitrate(width: 16, height: 16, fps: 1), 1_000_000)
        XCTAssertEqual(EncoderConfig.defaultBitrate(width: 4096, height: 4096, fps: 60), 20_000_000)
    }

    func testAnExplicitBitrateIsKeptWithinTheRange() throws {
        XCTAssertEqual(try EncoderConfig.resolve(width: 1080, height: 1920, fps: 30, bitrate: 8_000_000).bitrate, 8_000_000)
        XCTAssertEqual(try EncoderConfig.resolve(width: 1080, height: 1920, fps: 30, bitrate: 10).bitrate, 1_000_000)
        XCTAssertEqual(try EncoderConfig.resolve(width: 1080, height: 1920, fps: 30, bitrate: 1e12).bitrate, 20_000_000)
    }

    func testTheLimitsAreInclusive() throws {
        _ = try EncoderConfig.resolve(width: 16, height: 16, fps: 1, bitrate: nil)
        _ = try EncoderConfig.resolve(width: 4096, height: 4096, fps: 60, bitrate: nil)
    }

    func testBadSizesAndRatesAreConfigErrors() {
        assertRejected(width: 14)
        assertRejected(width: 4098)
        assertRejected(height: 8)
        assertRejected(height: 5000)
        assertRejected(width: 1081)
        assertRejected(height: 1919)
        assertRejected(width: 1080.5)
        assertRejected(width: Double.nan)
        assertRejected(height: Double.infinity)
        assertRejected(fps: 0)
        assertRejected(fps: 61)
        assertRejected(fps: 29.97)
        assertRejected(fps: -30)
        assertRejected(bitrate: 0)
        assertRejected(bitrate: -5)
        assertRejected(bitrate: Double.nan)
    }

    func testFilePathsAcceptUrisAndAbsolutePaths() throws {
        XCTAssertEqual(try FilePaths.fromUri("file:///var/mobile/tmp/replay.mp4", code: .config), "/var/mobile/tmp/replay.mp4")
        XCTAssertEqual(try FilePaths.fromUri("file:///data/a%20b/%C3%A9.mp4", code: .config), "/data/a b/\u{e9}.mp4")
        XCTAssertEqual(try FilePaths.fromUri("/sd/100%.mp4", code: .config), "/sd/100%.mp4")
        XCTAssertEqual(try FilePaths.fromUri("file:///sd/100%zz.mp4", code: .config), "/sd/100%zz.mp4")
        XCTAssertEqual(try FilePaths.fromUri("file:///a+b.mp4", code: .config), "/a+b.mp4")
    }

    func testFilePathsRejectEverythingElseWithTheGivenCode() {
        for bad in ["", "relative/frame.png", "content://media/1", "https://x/y.png", "file://", "/dir/"] {
            XCTAssertThrowsError(try FilePaths.fromUri(bad, code: .frame), bad) { error in
                XCTAssertEqual((error as? EncoderError)?.code, .frame)
            }
        }
    }

    func testErrorCodesAreTheOnesJsDocuments() {
        XCTAssertEqual(
            [EncoderErrorCode.unsupported, .config, .frame, .state, .io].map { $0.rawValue },
            ["ERR_ENCODER_UNSUPPORTED", "ERR_ENCODER_CONFIG", "ERR_ENCODER_FRAME", "ERR_ENCODER_STATE", "ERR_ENCODER_IO"]
        )
    }
}

final class FrameTimingTests: XCTestCase {
    func testPtsComesFromTheIntegerIndex() {
        XCTAssertEqual(FrameClock.ptsUs(index: 0, fps: 30), 0)
        XCTAssertEqual(FrameClock.ptsUs(index: 1, fps: 30), 33_333)
        XCTAssertEqual(FrameClock.ptsUs(index: 2, fps: 30), 66_666)
        XCTAssertEqual(FrameClock.ptsUs(index: 3, fps: 30), 100_000)
        XCTAssertEqual(FrameClock.ptsUs(index: 900, fps: 30), 30_000_000)
    }

    func testNoDriftOverAnHourOfFrames() {
        XCTAssertEqual(FrameClock.ptsUs(index: 30 * 3_600, fps: 30), 3_600_000_000)
        XCTAssertEqual(FrameClock.ptsUs(index: 24, fps: 24), 1_000_000)
        XCTAssertEqual(FrameClock.ptsUs(index: 1, fps: 60), 16_666)
    }

    func testFrameDurationsFollowThePatternOfTheRoundedDownTimes() {
        let durations = (0..<6).map { FrameClock.ptsUs(index: Int64($0 + 1), fps: 30) - FrameClock.ptsUs(index: Int64($0), fps: 30) }
        XCTAssertEqual(durations, [33_333, 33_333, 33_334, 33_333, 33_333, 33_334])
        for fps in [7, 24, 25, 29, 30, 60] {
            let floor = Int64(1_000_000 / fps)
            for index in 0..<500 {
                let d = FrameClock.ptsUs(index: Int64(index + 1), fps: fps) - FrameClock.ptsUs(index: Int64(index), fps: fps)
                XCTAssertTrue(d == floor || d == floor + 1, "fps \(fps) index \(index) duration \(d)")
            }
            XCTAssertEqual(FrameClock.ptsUs(index: Int64(fps), fps: fps), 1_000_000)
        }
    }

    func testDurationRoundsDownToTheMillisecond() {
        XCTAssertEqual(FrameClock.durationMs(frames: 900, fps: 30), 30_000)
        XCTAssertEqual(FrameClock.durationMs(frames: 1, fps: 30), 33)
        XCTAssertEqual(FrameClock.durationMs(frames: 0, fps: 30), 0)
        XCTAssertEqual(FrameClock.durationMs(frames: 60, fps: 60), 1_000)
    }

    private func assertFrameError(_ index: Int, _ sequencer: FrameSequencer, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try sequencer.check(index), file: file, line: line) { error in
            XCTAssertEqual((error as? EncoderError)?.code, .frame, file: file, line: line)
        }
    }

    func testSequencerAcceptsTheNextIndexOnly() throws {
        var sequencer = FrameSequencer()
        for i in 0..<5 {
            try sequencer.check(i)
            sequencer.advance()
        }
        XCTAssertEqual(sequencer.expected, 5)
    }

    func testSequencerRejectsGapsRepeatsAndAWrongStart() throws {
        var sequencer = FrameSequencer()
        assertFrameError(1, sequencer)
        try sequencer.check(0)
        sequencer.advance()
        assertFrameError(0, sequencer)
        assertFrameError(2, sequencer)
        assertFrameError(-1, sequencer)
    }

    func testARejectedIndexDoesNotAdvance() throws {
        let sequencer = FrameSequencer()
        assertFrameError(3, sequencer)
        XCTAssertEqual(sequencer.expected, 0)
        try sequencer.check(0)
    }
}

final class RawFrameTests: XCTestCase {
    private func bytes(_ text: String) -> [UInt8] { Array(text.utf8) }

    private func assertMalformed(_ data: [UInt8], length: Int? = nil, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try RawFrameHeader.parse(data, length: length), file: file, line: line) { error in
            XCTAssertEqual((error as? EncoderError)?.code, .frame, file: file, line: line)
        }
    }

    func testParsesTheViewShotHeader() throws {
        XCTAssertEqual(try RawFrameHeader.parse(bytes("1080:1920|")), RawFrameHeader(width: 1080, height: 1920, payloadOffset: 10))
    }

    func testIgnoresThePixelsAfterTheHeader() throws {
        let file = bytes("2:2|") + [UInt8](repeating: 0x7C, count: 16)
        XCTAssertEqual(try RawFrameHeader.parse(file), RawFrameHeader(width: 2, height: 2, payloadOffset: 4))
        XCTAssertEqual(try RawFrameHeader.parse(file, length: 8), RawFrameHeader(width: 2, height: 2, payloadOffset: 4))
    }

    func testTheExpectedLengthIsHeaderPlusFourBytesPerPixel() throws {
        let header = try RawFrameHeader.parse(bytes("1080:1920|"))
        XCTAssertEqual(header.payloadBytes, 1080 * 1920 * 4)
        try header.checkFileLength(10 + 1080 * 1920 * 4)
    }

    func testATruncatedOrOversizedFileIsRejected() throws {
        let header = try RawFrameHeader.parse(bytes("4:4|"))
        try header.checkFileLength(4 + 64)
        for length in [4 + 63, 4 + 65, 0, 4] {
            XCTAssertThrowsError(try header.checkFileLength(length), "length \(length)") { error in
                XCTAssertEqual((error as? EncoderError)?.code, .frame)
            }
        }
    }

    func testMalformedHeadersAreRejected() {
        let bad = ["", "|", "1080|", "1080:|", ":1920|", "1080:1920", "1080x1920|", "-1:5|", "0:5|", "5:0|", "1 080:1920|", "1080:1920:|", "99999999999:1|", "8193:2|", "8192:8192|"]
        for text in bad {
            assertMalformed(bytes(text))
        }
    }

    func testAHeaderCutOffByTheReadLengthIsRejected() {
        assertMalformed(bytes("1080:1920|"), length: 9)
        assertMalformed(bytes("1080:1920|"), length: 0)
    }

    func testAHeaderThatIsTooLongIsRejected() {
        assertMalformed(bytes("123456789012:1|"))
    }
}

final class FitRectTests: XCTestCase {
    func testSameAspectIsAPlainScale() {
        XCTAssertEqual(FitRect.fit(srcW: 540, srcH: 960, dstW: 1080, dstH: 1920, mode: .cover), FitRect(left: 0, top: 0, width: 1080, height: 1920))
        XCTAssertEqual(FitRect.fit(srcW: 2160, srcH: 3840, dstW: 1080, dstH: 1920, mode: .cover), FitRect(left: 0, top: 0, width: 1080, height: 1920))
        XCTAssertEqual(FitRect.fit(srcW: 540, srcH: 960, dstW: 1080, dstH: 1920, mode: .contain), FitRect(left: 0, top: 0, width: 1080, height: 1920))
        XCTAssertEqual(FitRect.fit(srcW: 1080, srcH: 1920, dstW: 1080, dstH: 1920, mode: .cover), FitRect(left: 0, top: 0, width: 1080, height: 1920))
    }

    func testCoverOfAWiderSourceMatchesTheHeightAndCropsTheSides() {
        // 1920x1080 landscape into the 1080x1920 portrait canvas: 3413.33 wide at full height, rounded up, centred.
        XCTAssertEqual(FitRect.fit(srcW: 1920, srcH: 1080, dstW: 1080, dstH: 1920, mode: .cover), FitRect(left: -1167, top: 0, width: 3414, height: 1920))
    }

    func testCoverOfATallerSourceMatchesTheWidthAndCropsTheEnds() {
        XCTAssertEqual(FitRect.fit(srcW: 1000, srcH: 3000, dstW: 1080, dstH: 1920, mode: .cover), FitRect(left: 0, top: -660, width: 1080, height: 3240))
    }

    func testContainLeavesBars() {
        XCTAssertEqual(FitRect.fit(srcW: 1920, srcH: 1080, dstW: 1080, dstH: 1920, mode: .contain), FitRect(left: 0, top: 656, width: 1080, height: 608))
        XCTAssertEqual(FitRect.fit(srcW: 1000, srcH: 1641, dstW: 1080, dstH: 1920, mode: .contain), FitRect(left: 0, top: 74, width: 1080, height: 1772))
    }

    func testCoverAlwaysCoversAndContainAlwaysFits() {
        let sources = [(1, 1), (2, 3), (3, 2), (1079, 1921), (1921, 1079), (4000, 17), (17, 4000), (540, 960)]
        for (sw, sh) in sources {
            let cover = FitRect.fit(srcW: sw, srcH: sh, dstW: 1080, dstH: 1920, mode: .cover)
            XCTAssertTrue(cover.width >= 1080 && cover.height >= 1920, "\(sw)x\(sh) cover \(cover)")
            XCTAssertTrue(
                cover.left <= 0 && cover.top <= 0 && cover.left + cover.width >= 1080 && cover.top + cover.height >= 1920,
                "\(sw)x\(sh) cover \(cover)")
            let contain = FitRect.fit(srcW: sw, srcH: sh, dstW: 1080, dstH: 1920, mode: .contain)
            XCTAssertTrue((1...1080).contains(contain.width) && (1...1920).contains(contain.height), "\(sw)x\(sh) contain \(contain)")
            XCTAssertTrue(
                contain.left >= 0 && contain.top >= 0 && contain.left + contain.width <= 1080 && contain.top + contain.height <= 1920,
                "\(sw)x\(sh) contain \(contain)")
        }
    }
}

final class YuvTests: XCTestCase {
    private func yuv(_ r: Int, _ g: Int, _ b: Int) -> [Int] { [Yuv.y(r, g, b), Yuv.u(r, g, b), Yuv.v(r, g, b)] }

    private func rgba(_ pixels: [Int]) -> [UInt8] {
        var out: [UInt8] = []
        for rgb in pixels {
            out += [UInt8((rgb >> 16) & 0xFF), UInt8((rgb >> 8) & 0xFF), UInt8(rgb & 0xFF), 0xFF]
        }
        return out
    }

    func testBlackAndWhiteAreTheLimitedRangeEnds() {
        XCTAssertEqual(yuv(0, 0, 0), [16, 128, 128])
        XCTAssertEqual(yuv(255, 255, 255), [235, 128, 128])
    }

    func testEveryGreyHasNeutralChroma() {
        for level in 0...255 {
            let c = yuv(level, level, level)
            XCTAssertEqual(c[1], 128, "grey \(level)")
            XCTAssertEqual(c[2], 128, "grey \(level)")
            XCTAssertTrue((16...235).contains(c[0]), "grey \(level) -> \(c[0])")
        }
    }

    func testPrimariesMatchTheBt709Table() {
        XCTAssertEqual(yuv(255, 0, 0), [63, 102, 240])
        XCTAssertEqual(yuv(0, 255, 0), [173, 42, 26])
        XCTAssertEqual(yuv(0, 0, 255), [32, 240, 118])
    }

    func testSecondariesMatchTheBt709Table() {
        XCTAssertEqual(yuv(255, 255, 0), [219, 16, 138])
        XCTAssertEqual(yuv(0, 255, 255), [188, 154, 16])
        XCTAssertEqual(yuv(255, 0, 255), [78, 214, 230])
    }

    func testEveryOutputStaysInTheLimitedRange() {
        for r in stride(from: 0, through: 255, by: 15) {
            for g in stride(from: 0, through: 255, by: 15) {
                for b in stride(from: 0, through: 255, by: 15) {
                    let c = yuv(r, g, b)
                    XCTAssertTrue((16...235).contains(c[0]), "\(r),\(g),\(b) y=\(c[0])")
                    XCTAssertTrue((16...240).contains(c[1]), "\(r),\(g),\(b) u=\(c[1])")
                    XCTAssertTrue((16...240).contains(c[2]), "\(r),\(g),\(b) v=\(c[2])")
                }
            }
        }
    }

    func testLumaRowConvertsEveryPixelAndHonoursTheOffset() {
        let data = rgba([0x123456, 0x000000, 0xFFFFFF, 0xFF0000, 0x00FF00])
        var out = [UInt8](repeating: 0, count: 3)
        Yuv.lumaRow(data, offset: 4, width: 3, into: &out)
        XCTAssertEqual(out, [16, 235, 63])
    }

    func testChromaRowAveragesTwoByTwoBlocks() {
        // Row 0: red red | black white. Row 1: red red | black white.
        let data = rgba([0xFF0000, 0xFF0000, 0x000000, 0xFFFFFF, 0xFF0000, 0xFF0000, 0x000000, 0xFFFFFF])
        var u = [UInt8](repeating: 0, count: 2)
        var v = [UInt8](repeating: 0, count: 2)
        Yuv.chromaRow(data, topOffset: 0, rowBytes: 16, width: 4, outU: &u, outV: &v)
        XCTAssertEqual(u[0], 102)
        XCTAssertEqual(v[0], 240)
        // black and white average to a mid grey: neutral chroma.
        XCTAssertEqual(u[1], 128)
        XCTAssertEqual(v[1], 128)
    }

    func testChromaOfAUniformBlockEqualsTheSinglePixelValue() {
        for color in [0x000000, 0xFFFFFF, 0x336699, 0xFF8000, 0x00FF00] {
            let data = rgba([color, color, color, color])
            var u = [UInt8](repeating: 0, count: 1)
            var v = [UInt8](repeating: 0, count: 1)
            Yuv.chromaRow(data, topOffset: 0, rowBytes: 8, width: 2, outU: &u, outV: &v)
            let r = (color >> 16) & 0xFF
            let g = (color >> 8) & 0xFF
            let b = color & 0xFF
            XCTAssertEqual(Int(u[0]), Yuv.u(r, g, b))
            XCTAssertEqual(Int(v[0]), Yuv.v(r, g, b))
        }
    }
}
