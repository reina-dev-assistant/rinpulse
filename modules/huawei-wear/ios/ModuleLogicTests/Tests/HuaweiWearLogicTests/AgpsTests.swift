import XCTest
@testable import HuaweiWearLogic

/// The pure parts of the satellite-data job (port of the Kotlin AgpsTest): schedule, validation, the bytes the phone sends, the store and the
/// source rules.
final class AgpsTests: XCTestCase {
    private func lto(_ size: Int = 115_749) -> Bytes {
        var data = Bytes((0..<size).map { UInt8(truncatingIfNeeded: $0 * 31) })
        data[0] = 0xFF
        data[1] = 0xCA
        data[2] = 0xDE
        return data
    }

    // MARK: policy

    func testRetryWaitsGrowThenStayAtSixHours() {
        let minute = 60_000
        XCTAssertEqual(AgpsPolicy.retryDelayMs(failures: 0), 0)
        XCTAssertEqual(AgpsPolicy.retryDelayMs(failures: 1), 1 * minute)
        XCTAssertEqual(AgpsPolicy.retryDelayMs(failures: 2), 5 * minute)
        XCTAssertEqual(AgpsPolicy.retryDelayMs(failures: 3), 15 * minute)
        XCTAssertEqual(AgpsPolicy.retryDelayMs(failures: 4), 60 * minute)
        XCTAssertEqual(AgpsPolicy.retryDelayMs(failures: 5), 360 * minute)
        XCTAssertEqual(AgpsPolicy.retryDelayMs(failures: 50), 360 * minute)
        XCTAssertEqual(AgpsPolicy.retryAtMs(lastFailureMs: 10_000, failures: 2), 10_000 + 5 * minute)
        XCTAssertEqual(AgpsPolicy.retryAtMs(lastFailureMs: 10_000, failures: 0), 0)
    }

    func testPrefetchIsDueWhenTheCopyIsMissingOrSixHoursOldAndNoRetryWaits() {
        let hour = 60 * 60_000
        let now = 100 * hour
        XCTAssertTrue(AgpsPolicy.prefetchDue(cachedAtMs: 0, nowMs: now, retryAtMs: 0))
        XCTAssertFalse(AgpsPolicy.prefetchDue(cachedAtMs: now - 5 * hour, nowMs: now, retryAtMs: 0))
        XCTAssertTrue(AgpsPolicy.prefetchDue(cachedAtMs: now - 6 * hour, nowMs: now, retryAtMs: 0))
        XCTAssertFalse(AgpsPolicy.prefetchDue(cachedAtMs: 0, nowMs: now, retryAtMs: now + 1), "a retry wait blocks it")
        XCTAssertTrue(AgpsPolicy.prefetchDue(cachedAtMs: 0, nowMs: now, retryAtMs: now))
    }

    func testDeliveryIsDueAfterADay() {
        let hour = 60 * 60_000
        let now = 1_000 * hour
        XCTAssertTrue(AgpsPolicy.deliveryDue(deliveredAtMs: 0, nowMs: now))
        XCTAssertFalse(AgpsPolicy.deliveryDue(deliveredAtMs: now - 23 * hour, nowMs: now))
        XCTAssertTrue(AgpsPolicy.deliveryDue(deliveredAtMs: now - 24 * hour, nowMs: now))
        XCTAssertEqual(AgpsPolicy.expiresAtMs(dataTimeMs: now), now + 7 * 24 * hour)
        XCTAssertEqual(AgpsPolicy.expiresAtMs(dataTimeMs: 0), 0)
    }

    func testTheConstantsAreTheSafetyRulesOfTheDoc() {
        XCTAssertEqual(AgpsPolicy.transferStallMs, 30_000)
        XCTAssertEqual(AgpsPolicy.pullWaitMs, 60_000)
        XCTAssertEqual(AgpsPolicy.downloadTimeoutMs, 120_000)
        XCTAssertEqual(AgpsPolicy.cacheFreshMs, 6 * 60 * 60_000)
        XCTAssertEqual(AgpsPolicy.deliverEveryMs, 24 * 60 * 60_000)
        XCTAssertEqual(AgpsPolicy.validMs, 7 * 24 * 60 * 60_000)
        XCTAssertEqual(AgpsPolicy.ltoMinBytes, 16 * 1024)
        XCTAssertEqual(AgpsPolicy.ltoMaxBytes, 1024 * 1024)
        XCTAssertEqual(AgpsPolicy.maxDataPerRequest, 1024 * 1024)
        XCTAssertEqual(AgpsPolicy.maxFrames, 65_535)
        XCTAssertEqual(EphemerisNet.ltoHost + EphemerisNet.ltoPath, "https://gllto.glpals.com/7day/v6/latest/lto.dat")
    }

    func testAGoodLtoFilePasses() {
        XCTAssertNil(AgpsPolicy.validateLto(lto()))
        XCTAssertNil(AgpsPolicy.validateLto(lto(AgpsPolicy.ltoMinBytes)))
        XCTAssertNil(AgpsPolicy.validateLto(lto(AgpsPolicy.ltoMaxBytes)))
    }

    func testLtoFilesOutsideTheBoundsOrWithAnotherHeaderAreRefused() {
        XCTAssertNotNil(AgpsPolicy.validateLto(lto(AgpsPolicy.ltoMinBytes - 1)))
        XCTAssertNotNil(AgpsPolicy.validateLto(lto(AgpsPolicy.ltoMaxBytes + 1)))
        var wrong = lto()
        wrong[2] = 0
        XCTAssertNotNil(AgpsPolicy.validateLto(wrong))
        let page = Array("<html>".utf8) + Bytes(repeating: 0, count: 40_000)
        XCTAssertTrue(AgpsPolicy.validateLto(page)!.contains("header"))
        XCTAssertNotNil(AgpsPolicy.validateLto([]))
    }

    func testFrameCountRoundsUpAndRefusesAbsurdTransfers() {
        XCTAssertEqual(AgpsPolicy.frameCount(size: 1, frameSize: 100), 1)
        XCTAssertEqual(AgpsPolicy.frameCount(size: 100, frameSize: 100), 1)
        XCTAssertEqual(AgpsPolicy.frameCount(size: 101, frameSize: 100), 2)
        XCTAssertEqual(AgpsPolicy.frameCount(size: 115_749, frameSize: 100), 1158)
        XCTAssertNil(AgpsPolicy.frameCount(size: 0, frameSize: 100))
        XCTAssertNil(AgpsPolicy.frameCount(size: 100, frameSize: 0))
        XCTAssertNil(AgpsPolicy.frameCount(size: 1024 * 1024, frameSize: 1), "one byte per frame of a megabyte")
        XCTAssertEqual(AgpsPolicy.frameCount(size: AgpsPolicy.maxFrames, frameSize: 1), AgpsPolicy.maxFrames)
    }

    // MARK: the bytes the phone sends

    func testOperatorAndRefusalAnswersCarryTheWireCodes() {
        XCTAssertEqual(AgpsMessages.operatorAnswer(code: AgpsMessages.codeOk).serialize().hexLower, "7f04000186a0")
        XCTAssertEqual(AgpsMessages.operatorAnswer(code: AgpsMessages.codeNoNetwork).serialize().hexLower, "7f04000186a7")
        XCTAssertEqual(AgpsMessages.refused().serialize().hexLower, "7f04000186a1")
        XCTAssertEqual(AgpsMessages.accepted().serialize().hexLower, "7f04000186a0")
    }

    func testParameterConsultIsAnEmptyContainer() {
        XCTAssertEqual(AgpsMessages.parameterConsult().serialize().hexLower, "8100")
    }

    func testProgressAnswerEchoesTheWatchTimeAndTheState() {
        let answer = AgpsMessages.progressAnswer(timeBytes: [0, 0, 1, 2], state: AgpsMessages.stateReady)
        XCTAssertEqual(answer.serialize().hexLower, "810c020102030400000102040103")
    }

    func testFileStatusIsOneByte() {
        XCTAssertEqual(AgpsMessages.fileStatus(state: AgpsMessages.stateReady).serialize().hexLower, "010103")
        XCTAssertEqual(AgpsMessages.fileStatus(state: AgpsMessages.stateFailed).serialize().hexLower, "010104")
        XCTAssertEqual(AgpsMessages.fileStatus(state: AgpsMessages.stateUnsupported).serialize().hexLower, "010105")
    }

    func testFileListJoinsNamesWithSemicolons() {
        XCTAssertEqual(AgpsMessages.fileList(names: ["a", "b"]).serialize().hexLower, "010361" + "3b62")
        XCTAssertEqual(AgpsMessages.fileList(names: ["gpslocation.dat"]).serialize().hexLower, "010f" + Array("gpslocation.dat".utf8).hexLower)
    }

    func testFileInfoCarriesSizeAndCrc() throws {
        // 115749 = 0x0001C425 as i32; the CRC as i16.
        XCTAssertEqual(AgpsMessages.fileInfo(size: 115_749, crc16: 0x1234).serialize().hexLower, "020400" + "01c425" + "03021234")
        let data = lto(1000)
        let crc = Int(CRC16.checksum(data))
        let tlv = try HuaweiTLV(parsing: AgpsMessages.fileInfo(size: data.count, crc16: crc).serialize())
        XCTAssertEqual(try tlv.int(0x02), 1000)
        XCTAssertEqual(try tlv.short(0x03), Int16(truncatingIfNeeded: crc))
    }

    func testDataAnswerCarriesTheStoredNameAndOffset() {
        let answer = AgpsMessages.dataAnswer(storedName: "ab", offset: 4096)
        XCTAssertEqual(answer.serialize().hexLower, "7f04000186a0" + "020261" + "62" + "0304" + "00001000")
    }

    func testStoredNameIsTheDigestOfTheAddressWithoutColons() {
        // SHA-256 of "AABBCCDDEEFF" (GB getHexDigest), checked against the digest of the colon-less text.
        XCTAssertEqual(EphemerisNet.addressDigest("AA:BB:CC:DD:EE:FF"), SHA256.hash(Array("AABBCCDDEEFF".utf8)).hexLower)
        XCTAssertEqual(EphemerisNet.addressDigest("AA:BB:CC:DD:EE:FF").count, 64)
        // The known SHA-256 of the empty string pins the hex format (lower case).
        XCTAssertEqual(EphemerisNet.addressDigest(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    }

    func testTheConsultAnswerIsParsedIntoVersionTagAndUrls() {
        var body = HuaweiTLV()
        body.put(0x04, int: 5)
        body.put(0x05, byte: 3)
        body.put(0x06, string: "a/b/HW_AGNSS;x/HW_PGNSS_PRED")
        var tlv = HuaweiTLV()
        tlv.put(0x81, tlv: body)
        let consult = AgpsMessages.parseConsult(tlv)!
        XCTAssertEqual(consult.version, 3)
        XCTAssertEqual(consult.tag, "a/b/HW_AGNSS;x/HW_PGNSS_PRED")
        XCTAssertEqual(consult.tagNames, "HW_AGNSS,HW_PGNSS_PRED", "only the names, never the paths")
        var other = HuaweiTLV()
        other.put(0x7F, int: 100_001)
        XCTAssertNil(AgpsMessages.parseConsult(other))
        XCTAssertNil(AgpsMessages.parseConsult(nil))
    }

    func testTheConsultAnswerListsTheUrlChildren() {
        var first = HuaweiTLV()
        first.put(0x03, string: "https://example.test/a")
        var second = HuaweiTLV()
        second.put(0x03, string: "https://example.test/b")
        var body = HuaweiTLV()
        body.put(0x05, byte: 0)
        body.put(0x83, tlv: first)
        body.put(0x83, tlv: second)
        var tlv = HuaweiTLV()
        tlv.put(0x81, tlv: body)
        let consult = AgpsMessages.parseConsult(tlv)!
        XCTAssertEqual(consult.version, 0)
        XCTAssertEqual(consult.tag, "")
        XCTAssertEqual(consult.urls, ["https://example.test/a", "https://example.test/b"])
    }

    // MARK: frames

    func testDataFramesAreIndexedAndCutAtTheTransferSize() throws {
        let params = ParamsProvider()
        params.transactionsCrypted = false
        let data = Bytes((0..<250).map { UInt8(truncatingIfNeeded: $0) })
        let frames = try HuaweiPacket(serviceId: 0x1C, commandId: 0x05).serializeFileChunk1c(
            data, transferSize: 100, packetCount: 3, useEncryption: false, params: params
        )
        XCTAssertEqual(frames.count, 3)
        var rebuilt = Bytes()
        for (index, f) in frames.enumerated() {
            // 5A, length (2), 00, service 1C, command 05, index, data..., CRC16 (2)
            XCTAssertEqual(f[0], 0x5A)
            XCTAssertEqual(f[4], 0x1C)
            XCTAssertEqual(f[5], 0x05)
            XCTAssertEqual(Int(f[6]), index)
            rebuilt += f[7..<f.count - 2]
            XCTAssertEqual(CRC16.checksum(Array(f[0..<f.count - 2])), f.u16be(f.count - 2))
        }
        XCTAssertEqual(rebuilt, data)
        XCTAssertEqual(frames[0].count - 9, 100)
        XCTAssertEqual(frames[2].count - 9, 50)
    }

    func testEncryptedDataFramesDecryptToIndexAndBytes() throws {
        let params = ParamsProvider()
        params.secretKey = Bytes(repeating: 0, count: 16)
        let data = Bytes((0..<130).map { UInt8(truncatingIfNeeded: $0 &* 7) })
        let frames = try HuaweiPacket(serviceId: 0x1C, commandId: 0x05).serializeFileChunk1c(
            data, transferSize: 60, packetCount: 3, useEncryption: true, params: params
        )
        var assembler = PacketAssembler()
        var plain = [Bytes]()
        for f in frames {
            let result = try assembler.feed(f, params: params)
            guard let packet = result.packet else { continue }
            XCTAssertEqual(packet.serviceId, 0x1C)
            XCTAssertEqual(packet.commandId, 0x05)
            let body = packet.payload!
            plain.append(try HuaweiTLV(parsing: body, offset: 2, length: body.count - 2).fileDownloadDecryptRaw(params: params))
        }
        XCTAssertEqual(plain.count, 3)
        XCTAssertEqual(plain.map { $0[0] }, [0, 1, 2])
        XCTAssertEqual(plain.flatMap { Array($0.dropFirst()) }, data)
    }

    // MARK: the store

    func testTheStoreStartsEmpty() {
        let store = AgpsStore(defaults: ephemeralDefaults())
        XCTAssertEqual(store.cachedAtMs, 0)
        XCTAssertEqual(store.lastAskVersion, -1)
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.none)
        XCTAssertEqual(store.retryAtMs(), 0)
    }

    func testFailuresAccumulateIntoTheRetryWaitAndASuccessOrTheUserClearsThem() {
        let store = AgpsStore(defaults: ephemeralDefaults())
        store.recordOutcome(nowMs: 1_000, outcome: AgpsOutcome.downloadFailed, error: "HTTP 503", countsAsFailure: true)
        XCTAssertEqual(store.failures, 1)
        XCTAssertEqual(store.retryAtMs(), 1_000 + 60_000)
        store.recordOutcome(nowMs: 2_000, outcome: AgpsOutcome.downloadFailed, error: "HTTP 503", countsAsFailure: true)
        XCTAssertEqual(store.failures, 2)
        XCTAssertEqual(store.retryAtMs(), 2_000 + 5 * 60_000)
        store.recordOutcome(nowMs: 3_000, outcome: AgpsOutcome.watchSilent, error: "no answer", countsAsFailure: false)
        XCTAssertEqual(store.failures, 2, "a silent watch is not a download failure")
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.watchSilent)
        store.clearRetry()
        XCTAssertEqual(store.retryAtMs(), 0)
        store.recordOutcome(nowMs: 4_000, outcome: AgpsOutcome.downloadFailed, error: "x", countsAsFailure: true)
        store.recordDownloaded(nowMs: 5_000, dataMs: 4_500, size: 1234, source: AgpsSources.broadcom)
        XCTAssertEqual(store.failures, 0)
        XCTAssertEqual(store.cachedSize, 1234)
        XCTAssertEqual(store.cachedDataMs, 4_500)
    }

    func testADeliveryIsRememberedPerWatchAndCountsAsTheOutcome() {
        let store = AgpsStore(defaults: ephemeralDefaults())
        store.recordDelivered(nowMs: 9_000, dataMs: 8_000, size: 115_749, source: AgpsSources.broadcom, address: "AA:BB:CC:DD:EE:FF")
        XCTAssertEqual(store.deliveredAtMs, 9_000)
        XCTAssertEqual(store.deliveredSize, 115_749)
        XCTAssertEqual(store.deliveredAddress, "AA:BB:CC:DD:EE:FF")
        XCTAssertEqual(store.lastOutcome, AgpsOutcome.delivered)
        XCTAssertEqual(store.lastError, "")
    }

    func testTheAskKeepsTagNamesOnlyAndIsCapped() {
        let store = AgpsStore(defaults: ephemeralDefaults())
        store.recordAsk(nowMs: 7, version: 3, tags: String(repeating: "x", count: 500))
        XCTAssertEqual(store.lastAskTags.count, 120)
        XCTAssertEqual(store.lastAskVersion, 3)
        XCTAssertEqual(store.lastAskMs, 7)
    }

    func testTheErrorTextIsCapped() {
        let store = AgpsStore(defaults: ephemeralDefaults())
        store.recordOutcome(nowMs: 1, outcome: AgpsOutcome.downloadFailed, error: String(repeating: "e", count: 500), countsAsFailure: false)
        XCTAssertEqual(store.lastError.count, 200)
    }

    // MARK: the source

    private final class MemoryCache: AgpsCache, @unchecked Sendable {
        private let lock = NSLock()
        private var _entries: [String: Bytes] = [:]
        var entries: [String: Bytes] {
            get { lock.locked { _entries } }
            set { lock.locked { _entries = newValue } }
        }
        func read(_ url: String, maxAgeMs: Int) -> Bytes? { lock.locked { _entries[url] } }
        func write(_ url: String, data: Bytes) { lock.locked { _entries[url] = data } }
        func delete(_ url: String) { lock.locked { _entries[url] = nil } }
    }

    private let ltoUrl = EphemerisNet.ltoHost + EphemerisNet.ltoPath

    private func source(
        _ cache: AgpsCache, _ store: AgpsStore, online: Bool = true,
        get: @escaping @Sendable (String, Int) async throws -> AgpsDownload = { _, _ in throw AgpsFetchError("the network must not be used here") }
    ) -> NetworkAgpsSource {
        NetworkAgpsSource(cache: cache, store: store, log: { _ in }, isOnline: { online }, nowMs: { 50_000 }, httpGet: get)
    }

    func testVersionZeroServesAGoodCachedFileAndMarksItAsCached() async {
        let cache = MemoryCache()
        cache.entries[ltoUrl] = lto()
        let store = AgpsStore(defaults: ephemeralDefaults())
        store.recordDownloaded(nowMs: 40_000, dataMs: 39_000, size: 115_749, source: AgpsSources.broadcom)
        let fetch = await source(cache, store).fetch(.default, force: false)
        XCTAssertTrue(fetch.ok)
        XCTAssertTrue(fetch.fromCache)
        XCTAssertEqual(fetch.source, AgpsSources.broadcom)
        XCTAssertEqual(fetch.dataTimeMs, 39_000)
        XCTAssertEqual(fetch.files.map(\.name), [AgpsSources.ltoFile])
    }

    func testABrokenCachedFileIsDroppedAndOfflineThenSaysSo() async {
        let cache = MemoryCache()
        cache.entries[ltoUrl] = Bytes(repeating: 0, count: 100)
        let fetch = await source(cache, AgpsStore(defaults: ephemeralDefaults()), online: false).fetch(.default, force: false)
        XCTAssertFalse(fetch.ok)
        XCTAssertEqual(fetch.outcome, AgpsOutcome.noNetwork)
        XCTAssertTrue(cache.entries.isEmpty, "the bad copy is gone")
    }

    func testForceSkipsTheCacheAndOfflineReportsNoNetwork() async {
        let cache = MemoryCache()
        cache.entries[ltoUrl] = lto()
        let fetch = await source(cache, AgpsStore(defaults: ephemeralDefaults()), online: false).fetch(.default, force: true)
        XCTAssertEqual(fetch.outcome, AgpsOutcome.noNetwork)
    }

    func testADownloadedGoodFileIsServedWithItsLastModifiedAndCached() async {
        let cache = MemoryCache()
        let file = lto()
        let fetch = await source(cache, AgpsStore(defaults: ephemeralDefaults()), get: { url, max in
            XCTAssertEqual(url, "https://gllto.glpals.com/7day/v6/latest/lto.dat")
            XCTAssertEqual(max, AgpsPolicy.ltoMaxBytes)
            return AgpsDownload(body: file, lastModifiedMs: 44_000)
        }).fetch(.default, force: false)
        XCTAssertTrue(fetch.ok)
        XCTAssertFalse(fetch.fromCache)
        XCTAssertEqual(fetch.dataTimeMs, 44_000)
        XCTAssertEqual(fetch.files[0].data, file)
        XCTAssertEqual(cache.entries[ltoUrl], file)
    }

    func testADownloadWithoutLastModifiedIsDatedByTheDownloadTime() async {
        let file = lto()
        let fetch = await source(MemoryCache(), AgpsStore(defaults: ephemeralDefaults()), get: { _, _ in
            AgpsDownload(body: file, lastModifiedMs: 0)
        }).fetch(.default, force: false)
        XCTAssertEqual(fetch.dataTimeMs, 50_000)
    }

    func testADownloadThatIsNotAnLtoFileIsInvalidAndNeverCached() async {
        let cache = MemoryCache()
        let page = Array("<html>".utf8) + Bytes(repeating: 0, count: 40_000)
        let fetch = await source(cache, AgpsStore(defaults: ephemeralDefaults()), get: { _, _ in AgpsDownload(body: page, lastModifiedMs: 1) })
            .fetch(.default, force: false)
        XCTAssertFalse(fetch.ok)
        XCTAssertEqual(fetch.outcome, AgpsOutcome.invalidFile)
        XCTAssertTrue(cache.entries.isEmpty)
    }

    func testAFailedDownloadIsADownloadFailureWithTheReason() async {
        let fetch = await source(MemoryCache(), AgpsStore(defaults: ephemeralDefaults()), get: { _, _ in throw AgpsFetchError("HTTP 503") })
            .fetch(.default, force: false)
        XCTAssertEqual(fetch.outcome, AgpsOutcome.downloadFailed)
        XCTAssertEqual(fetch.message, "LTO: HTTP 503")
    }

    func testVersionsOneToThreeAreDeclinedAsUnsupportedWithoutTouchingTheNetworkOrTheCache() async {
        let cache = MemoryCache()
        cache.entries[ltoUrl] = lto()
        let store = AgpsStore(defaults: ephemeralDefaults())
        for version in 1...3 {
            let consult = AgpsConsult(version: version, tag: "p/q/HW_AGNSS;x/HW_PGNSS_PRED", urls: [])
            let fetch = await source(cache, store).fetch(consult, force: false)
            XCTAssertFalse(fetch.ok, "the Broadcom file is never offered to a watch that asked for another kind")
            XCTAssertEqual(fetch.outcome, AgpsOutcome.unsupported)
            XCTAssertTrue(fetch.message.contains("HW_AGNSS,HW_PGNSS_PRED"))
            XCTAssertFalse(fetch.message.contains("p/q"), "paths are not echoed")
        }
        XCTAssertNotNil(cache.entries[ltoUrl], "the phone's copy is left alone")
    }

    func testUnknownVersionsAreUnsupported() async {
        let fetch = await source(MemoryCache(), AgpsStore(defaults: ephemeralDefaults())).fetch(AgpsConsult(version: 9, tag: "", urls: []), force: false)
        XCTAssertEqual(fetch.outcome, AgpsOutcome.unsupported)
    }

    // MARK: HTTP helpers

    func testHttpDatesAreReadAsUnixMilliseconds() {
        XCTAssertEqual(EphemerisNet.parseHttpDate("Sun, 06 Nov 1994 08:49:37 GMT"), 784_111_777_000)
        XCTAssertNil(EphemerisNet.parseHttpDate(nil))
        XCTAssertNil(EphemerisNet.parseHttpDate("yesterday"))
    }

    func testTheCacheKeepsAFileUntilItIsTooOld() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("agps-cache-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = EphemerisCache(directory: directory)
        XCTAssertNil(cache.read("https://x.test/a", maxAgeMs: 60_000))
        cache.write("https://x.test/a", data: [1, 2, 3])
        XCTAssertEqual(cache.read("https://x.test/a", maxAgeMs: 60_000), [1, 2, 3])
        XCTAssertNil(cache.read("https://x.test/a", maxAgeMs: -1), "older than the allowed age")
        XCTAssertNil(cache.read("https://x.test/b", maxAgeMs: 60_000))
        cache.delete("https://x.test/a")
        XCTAssertNil(cache.read("https://x.test/a", maxAgeMs: 60_000))
    }

    func testTheNetworkRefusesAnythingButHttps() async {
        do {
            _ = try await EphemerisNet.get("http://gllto.glpals.com/7day/v6/latest/lto.dat", maxBytes: 1000)
            XCTFail("a plain http request must be refused")
        } catch let error as AgpsFetchError {
            XCTAssertTrue(error.message.contains("non-https"))
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }
}

/// A source that answers from a list: files, or the failure `outcome`; `gate` holds the answer back until it is opened (or 5 s pass).
final class FakeAgpsSource: AgpsSource, @unchecked Sendable {
    private let lock = NSLock()
    private let files: [(name: String, data: Bytes)]
    private let outcome: String
    private let gate: AgpsLatch<Bool>?
    private var _calls = 0
    private var _forces: [Bool] = []

    init(files: [(name: String, data: Bytes)], outcome: String = AgpsOutcome.none, gate: AgpsLatch<Bool>? = nil) {
        self.files = files
        self.outcome = outcome
        self.gate = gate
    }

    var calls: Int { lock.locked { _calls } }
    var forces: [Bool] { lock.locked { _forces } }

    func fetch(_ consult: AgpsConsult, force: Bool) async -> AgpsFetch {
        lock.locked {
            _calls += 1
            _forces.append(force)
        }
        if let gate { _ = await gate.wait(timeoutMs: 5_000) }
        if !files.isEmpty {
            return AgpsFetch(files: files, source: AgpsSources.broadcom, dataTimeMs: 1_000, outcome: AgpsOutcome.none, message: "")
        }
        return .failed(outcome, "fake \(outcome)")
    }
}
