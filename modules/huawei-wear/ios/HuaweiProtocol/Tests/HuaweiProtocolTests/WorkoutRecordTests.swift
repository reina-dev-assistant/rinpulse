import XCTest
@testable import HuaweiProtocol

/// WorkoutRecordTest.kt translated, plus the summary values WorkoutBuilder derives (the Kotlin ones are only exercised through WorkoutSyncTest).
final class WorkoutRecordTests: XCTestCase {
    private func block(type: Int8, pace: Int32, correction: Int16?) -> Workout.WorkoutPace.Response.Block {
        var b = Workout.WorkoutPace.Response.Block()
        b.type = type
        b.pace = pace
        if let correction {
            b.hasCorrection = true
            b.correction = correction
        }
        return b
    }

    private func totalsResponse(_ build: (inout HuaweiTLV) -> Void) throws -> Workout.WorkoutTotals.Response {
        var inner = HuaweiTLV()
        inner.put(0x02, short: 5)
        inner.put(0x04, int: 1_700_000_000)
        inner.put(0x05, int: 1_700_000_600)
        build(&inner)
        var tlv = HuaweiTLV()
        tlv.put(0x81, tlv: inner)
        return try Workout.WorkoutTotals.Response(packet: HuaweiPacket(serviceId: 0x17, commandId: 0x08, tlv: tlv))
    }

    private func json(_ record: WorkoutRecord) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(record.summaryJson.utf8)) as? [String: Any])
    }

    private func sample(
        hr: Int8 = -1, altitude: Int32? = nil, speed: Int16 = -1, cadence: Int16 = -1, stepRate: Int8 = -1, stepLength: Int16 = -1, power: Int16 = -1,
        timestamp: Int32 = 1_700_000_000
    ) -> Workout.WorkoutData.Response.Data {
        var d = Workout.WorkoutData.Response.Data()
        d.heartRate = hr
        d.altitude = altitude
        d.speed = speed
        d.cadence = cadence
        d.stepRate = stepRate
        d.stepLength = stepLength
        d.cyclingPower = power
        d.timestamp = timestamp
        return d
    }

    // MARK: Kotlin cases

    func testSportTypesUseGadgetbridgeNames() {
        XCTAssertEqual(WorkoutSportTypes.name(1), "Running")
        XCTAssertEqual(WorkoutSportTypes.kind(1), "RUNNING")
        XCTAssertEqual(WorkoutSportTypes.name(6), "Pool Swimming")
        XCTAssertEqual(WorkoutSportTypes.name(128), "Ping Pong")
        XCTAssertEqual(WorkoutSportTypes.kind(255), "EXERCISE")
        // The type byte is read unsigned: 0xFF arrives as -1.
        XCTAssertEqual(WorkoutSportTypes.kind(-1), "EXERCISE")
        XCTAssertEqual(WorkoutSportTypes.name(99), "Workout (type 99)")
        XCTAssertEqual(WorkoutSportTypes.kind(99), "UNKNOWN")
    }

    func testPaceAndSwimClassification() {
        XCTAssertTrue(WorkoutSportTypes.isSwim("POOL_SWIM"))
        XCTAssertTrue(WorkoutSportTypes.isPace("TRAIL_RUN"))
        XCTAssertTrue(WorkoutSportTypes.isPace("INDOOR_WALKING"))
        XCTAssertFalse(WorkoutSportTypes.isPace("CYCLING"))
    }

    func testPaceAggregatesWeightPartialKilometres() {
        // Two full km at 300 and 360 s/km, then half a km at 330. Per-mile blocks are ignored.
        let blocks = [block(type: 0, pace: 300, correction: nil), block(type: 0, pace: 360, correction: nil), block(type: 0, pace: 330, correction: 5000), block(type: 1, pace: 500, correction: nil)]

        let aggregates = WorkoutBuilder.paceAggregates(blocks)

        let expectedAvg: Int = (3_000_000 + 3_600_000 + 1_650_000) / 25_000
        XCTAssertEqual(aggregates?.avg, expectedAvg)
        XCTAssertEqual(aggregates?.fastest, 300)
        XCTAssertEqual(aggregates?.slowest, 360)
        XCTAssertNil(WorkoutBuilder.paceAggregates([block(type: 1, pace: 500, correction: nil)]))
    }

    func testSwimStylesFollowGb() {
        XCTAssertEqual(WorkoutBuilder.swimStyle(1), "breaststroke")
        XCTAssertEqual(WorkoutBuilder.swimStyle(3), "butterfly")
        XCTAssertEqual(WorkoutBuilder.swimStyle(4), "backstroke")
        XCTAssertEqual(WorkoutBuilder.swimStyle(5), "medley")
        XCTAssertEqual(WorkoutBuilder.swimStyle(0), "freestyle")
    }

    func testHeartRateMarkersAreNotReadings() {
        XCTAssertNil(WorkoutBuilder.validHeartRate(0))
        XCTAssertNil(WorkoutBuilder.validHeartRate(-1))
        XCTAssertEqual(WorkoutBuilder.validHeartRate(Int8(bitPattern: 200)), 200)
    }

    func testSportTableHasEveryGbSport() {
        XCTAssertEqual((0...255).compactMap { WorkoutSportTypes.sport($0) }.count, 107)
    }

    // MARK: builder

    func testDurationFallsBackFromDurationToTotalTimeToTheSpan() throws {
        let both = WorkoutBuilder.build(WorkoutParts(totals: try totalsResponse { $0.put(0x09, int: 640); $0.put(0x12, int: 600) }), complete: true)
        XCTAssertEqual(both.duration, 600)
        let totalOnly = WorkoutBuilder.build(WorkoutParts(totals: try totalsResponse { $0.put(0x09, int: 640) }), complete: true)
        XCTAssertEqual(totalOnly.duration, 640)
        let neither = WorkoutBuilder.build(WorkoutParts(totals: try totalsResponse { _ in }), complete: true)
        XCTAssertEqual(neither.duration, 600)
        XCTAssertEqual(neither.distance, 0, "absent totals are 0, not the wire's -1")
        XCTAssertEqual(neither.calories, 0)
        XCTAssertEqual(neither.steps, 0)
    }

    func testTimesAreUnsignedAndTheTypeByteIsReadUnsigned() throws {
        var inner = HuaweiTLV()
        inner.put(0x02, short: 1)
        inner.put(0x04, int: Int32(bitPattern: 0xF000_0000))
        inner.put(0x05, int: Int32(bitPattern: 0xF000_0100))
        inner.put(0x14, byte: 0xFF)
        var tlv = HuaweiTLV()
        tlv.put(0x81, tlv: inner)
        let totals = try Workout.WorkoutTotals.Response(packet: HuaweiPacket(serviceId: 0x17, commandId: 0x08, tlv: tlv))

        let record = WorkoutBuilder.build(WorkoutParts(totals: totals), complete: false)

        XCTAssertEqual(record.start, 0xF000_0000)
        XCTAssertEqual(record.end, 0xF000_0100)
        XCTAssertEqual(record.sportType, 255)
        XCTAssertEqual(record.sportName, "Exercise")
        XCTAssertFalse(record.complete)
        XCTAssertEqual(record.duration, 256)
    }

    func testHeartRateStatsFromSamplesAndTheWatchPeaks() throws {
        let parts = WorkoutParts(totals: try totalsResponse { $0.put(0x0c, bytes: [60, 190]) })
        parts.samples = [sample(hr: 100), sample(hr: 0), sample(hr: -1), sample(hr: 121), sample(hr: Int8(bitPattern: 200))]

        let record = WorkoutBuilder.build(parts, complete: true)

        XCTAssertEqual(record.avgHr, 140) // (100 + 121 + 200) / 3 = 140.33
        XCTAssertEqual(record.maxHr, 200)
        let j = try json(record)
        XCTAssertEqual(j["minHr"] as? Int, 100)
        XCTAssertEqual(j["hrPeakMin"] as? Int, 60)
        XCTAssertEqual(j["hrPeakMax"] as? Int, 190)
    }

    func testMaxHeartRateFallsBackToTheWatchPeakWithoutSamples() throws {
        let record = WorkoutBuilder.build(WorkoutParts(totals: try totalsResponse { $0.put(0x0c, bytes: [60, 190]) }), complete: true)
        XCTAssertNil(record.avgHr)
        XCTAssertEqual(record.maxHr, 190)
    }

    func testAverageHeartRateRoundsHalfUpLikeJava() throws {
        let parts = WorkoutParts(totals: try totalsResponse { _ in })
        parts.samples = [sample(hr: 100), sample(hr: 101)]
        XCTAssertEqual(WorkoutBuilder.build(parts, complete: true).avgHr, 101)
    }

    func testAltitudeStatsAndDecimetresInTheSummary() throws {
        let parts = WorkoutParts(totals: try totalsResponse { _ in })
        parts.samples = [sample(altitude: 100), sample(altitude: 150), sample(altitude: 120)]

        let j = try json(WorkoutBuilder.build(parts, complete: true))

        XCTAssertEqual(j["minAltitude"] as? Double, 10.0)
        XCTAssertEqual(j["maxAltitude"] as? Double, 15.0)
        XCTAssertEqual(j["elevationGain"] as? Double, 5.0)
        XCTAssertEqual(j["elevationLoss"] as? Double, 3.0)
        XCTAssertEqual(j["avgAltitude"] as? Double, 123.0 / 10.0, "round(123.33) = 123 decimetres")
    }

    func testTotalsAltitudeWinsOverTheSamples() throws {
        let parts = WorkoutParts(totals: try totalsResponse { $0.put(0x1c, int: 2000); $0.put(0x1d, int: -50); $0.put(0x0b, int: 300); $0.put(0x1b, int: 120) })
        parts.samples = [sample(altitude: 100), sample(altitude: 150)]

        let j = try json(WorkoutBuilder.build(parts, complete: true))

        XCTAssertEqual(j["maxAltitude"] as? Double, 200.0)
        XCTAssertEqual(j["minAltitude"] as? Double, -5.0)
        XCTAssertEqual(j["elevationGain"] as? Double, 30.0)
        XCTAssertEqual(j["elevationLoss"] as? Double, 12.0)
    }

    func testDivingReportsMaxDepthInsteadOfElevation() throws {
        let parts = WorkoutParts(totals: try totalsResponse { $0.put(0x14, byte: 25); $0.put(0x1b, int: 600); $0.put(0x0b, int: 10) })

        let j = try json(WorkoutBuilder.build(parts, complete: true))

        XCTAssertEqual(j["kind"] as? String, "SCUBA_DIVING")
        XCTAssertEqual(j["maxDepth"] as? Double, 60.0)
        XCTAssertNil(j["elevationLoss"])
        XCTAssertNil(j["elevationGain"])
    }

    func testPaceFiguresPerSport() throws {
        func record(type: UInt8) throws -> [String: Any] {
            try json(WorkoutBuilder.build(WorkoutParts(totals: try totalsResponse {
                $0.put(0x07, int: 1000); $0.put(0x12, int: 300); $0.put(0x14, byte: type)
            }), complete: true))
        }
        let running = try record(type: 1)
        XCTAssertEqual(running["avgSpeed"] as? Double, 1000.0 / 300.0)
        XCTAssertEqual(running["avgPaceSecPerKm"] as? Double, 300.0)
        XCTAssertNil(running["avgPaceSecPer100m"])
        let swimming = try record(type: 6)
        XCTAssertEqual(swimming["avgPaceSecPer100m"] as? Double, 100.0 / (1000.0 / 300.0))
        XCTAssertNil(swimming["avgPaceSecPerKm"])
        let cycling = try record(type: 3)
        XCTAssertNotNil(cycling["avgSpeed"])
        XCTAssertNil(cycling["avgPaceSecPerKm"])
    }

    func testMaxSpeedIsDecimetresPerSecond() throws {
        let parts = WorkoutParts(totals: try totalsResponse { $0.put(0x14, byte: 1) })
        parts.samples = [sample(speed: 30), sample(speed: 50), sample(speed: -1)]

        let j = try json(WorkoutBuilder.build(parts, complete: true))

        XCTAssertEqual(j["maxSpeed"] as? Double, 5.0)
        XCTAssertEqual(j["minPaceSecPerKm"] as? Double, 200.0)
    }

    func testWalkingWithNewStepsAveragesTheStepRateByte() throws {
        let totals = try totalsResponse { $0.put(0x14, byte: 2) }
        let parts = WorkoutParts(totals: totals)
        parts.newSteps = true
        parts.samples = [sample(cadence: 999, stepRate: 100), sample(cadence: 999, stepRate: Int8(bitPattern: 140))]
        let walking = try json(WorkoutBuilder.build(parts, complete: true))
        XCTAssertEqual((walking["samples"] as? [String: Any])?["avgStepRate"] as? Double, 120.0)
        XCTAssertNil((walking["samples"] as? [String: Any])?["avgCadence"])

        let old = WorkoutParts(totals: totals)
        old.samples = [sample(cadence: 80), sample(cadence: 100)]
        let cadence = try json(WorkoutBuilder.build(old, complete: true))
        XCTAssertEqual((cadence["samples"] as? [String: Any])?["avgCadence"] as? Double, 90.0)
    }

    func testSummaryKeysFromTheTotals() throws {
        let parts = WorkoutParts(totals: try totalsResponse {
            $0.put(0x03, byte: 1)
            $0.put(0x09, int: 640)
            $0.put(0x0d, int: 77)
            $0.put(0x0e, int: 35)
            $0.put(0x20, byte: 14)
            $0.put(0x10, int: 40000)
            $0.put(0x11, short: 900)
            $0.put(0x63, short: 250)
            $0.put(0x24, byte: 2)
            $0.put(0x66, bytes: [90, 80, 70])
            $0.put(0x15, byte: 4)
            $0.put(0x16, short: 800)
            $0.put(0x18, short: 2500)
            $0.put(0x56, short: 7)
            $0.put(0x50, short: 1)
            $0.put(0x55, short: 6)
            var extra = HuaweiTLV()
            extra.put(0x68, int: 300_010_027)
            extra.put(0x69, string: "tab\there \"q\"")
            $0.put(0xe7, tlv: extra)
        })
        parts.gpsStatus = "ok"
        parts.missingData = true

        let record = WorkoutBuilder.build(parts, complete: true)
        let j = try json(record)

        XCTAssertEqual(j["number"] as? Int, 5)
        XCTAssertEqual(j["status"] as? Int, 1)
        XCTAssertEqual(j["totalTime"] as? Int, 640)
        XCTAssertEqual(j["newSteps"] as? Bool, false)
        XCTAssertEqual(j["gps"] as? String, "ok")
        XCTAssertEqual(j["missingData"] as? Bool, true)
        XCTAssertEqual(j["workoutLoad"] as? Int, 77)
        XCTAssertEqual(j["aerobicEffect"] as? Double, 3.5)
        XCTAssertEqual(j["anaerobicEffect"] as? Double, 1.4)
        XCTAssertEqual(j["recoveryHours"] as? Double, 15.0)
        XCTAssertEqual(j["vo2max"] as? Int, Int(Float(40000) * 3.5) / 65536)
        XCTAssertEqual(j["trainingPoints"] as? Int, 250)
        XCTAssertEqual(j["hrZoneType"] as? Int, 2)
        XCTAssertEqual(j["recoveryHeartRates"] as? [Int], [90, 80, 70])
        let swim = try XCTUnwrap(j["swim"] as? [String: Any])
        XCTAssertEqual(swim["style"] as? String, "backstroke")
        XCTAssertEqual(swim["strokes"] as? Int, 800)
        XCTAssertEqual(swim["poolLengthCm"] as? Int, 2500)
        let zones = try XCTUnwrap(j["runPaceZones"] as? [String: Any])
        XCTAssertEqual((zones["zones"] as? [[String: Any]])?.count, 5)
        XCTAssertEqual((zones["zones"] as? [[String: Any]])?.first?["seconds"] as? Int, 7)
        XCTAssertEqual(zones["slowestMax"] as? Int, 6)
        XCTAssertEqual((j["additional"] as? [String: Any])?["waterType"] as? String, "tab\there \"q\"")
        XCTAssertEqual((j["rawTotals"] as? String)?.count, (parts.totals.rawData?.count ?? 0) * 2)
        XCTAssertEqual(j["rawTotals"] as? String, parts.totals.rawData?.hexUpper)
    }

    func testJumpRopeSummary() throws {
        let parts = WorkoutParts(totals: try totalsResponse { $0.put(0x14, byte: 21); $0.put(0x08, int: 1234); $0.put(0x5b, int: 88); $0.put(0x5c, short: 5) })

        let j = try json(WorkoutBuilder.build(parts, complete: true))

        XCTAssertEqual(j["jumps"] as? Int, 1234)
        XCTAssertEqual(j["longestStreak"] as? Int, 88)
        XCTAssertEqual(j["interruptions"] as? Int, 5)
    }

    func testPointsMergeSamplesAndGpsInTimeOrderSamplesFirst() throws {
        let parts = WorkoutParts(totals: try totalsResponse { _ in })
        parts.samples = [sample(hr: 120, altitude: 55, timestamp: 1_700_000_010), sample(hr: 0, timestamp: 1_700_000_020), sample(hr: 110, timestamp: 1_700_000_000)]
        var p = GpsPoint()
        p.timestamp = 1_700_000_010
        p.latitude = -6.2
        p.longitude = 106.8
        p.altitudeSupported = true
        p.altitude = 12
        parts.gps = [p]

        let points = WorkoutBuilder.points(parts)

        XCTAssertEqual(points.map(\.ts), [1_700_000_000, 1_700_000_010, 1_700_000_010])
        XCTAssertEqual(points[1], WorkoutPoint(ts: 1_700_000_010, lat: nil, lon: nil, alt: 5.5, hr: 120))
        XCTAssertEqual(points[2], WorkoutPoint(ts: 1_700_000_010, lat: -6.2, lon: 106.8, alt: 12, hr: nil))
        XCTAssertEqual(points.count, 3, "a sample with neither heart rate nor altitude is dropped")
    }

    func testSamplePointsKeepSpeedCadenceStrideAndPowerInSiUnits() throws {
        let parts = WorkoutParts(totals: try totalsResponse { $0.put(0x14, byte: 1) })
        parts.samples = [
            sample(hr: Int8(truncatingIfNeeded: 150), speed: 31, cadence: 172, stepLength: 105, power: 240, timestamp: 1_700_000_000),
            // Zero and -1 are "no reading"; a sample with nothing else is dropped.
            sample(speed: 0, cadence: 0, stepLength: 0, power: 0, timestamp: 1_700_000_005),
            sample(timestamp: 1_700_000_010),
            sample(speed: 28, timestamp: 1_700_000_015),
        ]

        let points = WorkoutBuilder.points(parts)

        XCTAssertEqual(points.count, 2)
        XCTAssertEqual(points[0], WorkoutPoint(ts: 1_700_000_000, lat: nil, lon: nil, alt: nil, hr: 150, speed: 3.1, cadence: 172, stride: 1.05, power: 240))
        XCTAssertEqual(points[1], WorkoutPoint(ts: 1_700_000_015, lat: nil, lon: nil, alt: nil, hr: nil, speed: 2.8))
    }

    func testWalkingWithTheNewStepAlgorithmReadsCadenceFromTheStepRateByte() throws {
        let walking = WorkoutParts(totals: try totalsResponse { $0.put(0x14, byte: 2) })
        walking.newSteps = true
        walking.samples = [sample(cadence: 99, stepRate: 110, timestamp: 1_700_000_000), sample(cadence: 99, stepRate: -1, timestamp: 1_700_000_005)]
        XCTAssertEqual(WorkoutBuilder.points(walking).map(\.cadence), [110], "0xFF in the step-rate byte is the no-reading marker")

        walking.newSteps = false
        XCTAssertEqual(WorkoutBuilder.points(walking).map(\.cadence), [99, 99])
    }

    func testRunningFormIsAveragedOverReadingsAndKeptAsAPerMinuteSeries() throws {
        let t0: Int32 = 1_700_000_000
        func form(_ ts: Int32, gct: Int16 = -1, vo: Float = 0, vr: Float = 0, gtb: Float = 0, hang: Int16 = -1) -> Workout.WorkoutData.Response.Data {
            var d = sample(timestamp: ts)
            d.groundContactTime = gct
            d.vo = vo
            d.vr = vr
            d.gtb = gtb
            d.hangTime = hang
            return d
        }
        let parts = WorkoutParts(totals: try totalsResponse { $0.put(0x14, byte: 1) })
        parts.samples = [
            form(t0, gct: 240, vo: 8.4, vr: 7.1, gtb: 50.2, hang: 120),
            form(t0 + 30, gct: 260, vo: 9.0, vr: 7.5, gtb: 49.8),
            form(t0 + 45, gct: 0),
            form(t0 + 70, gct: 300, vo: 10.0),
        ]
        let summary = try json(WorkoutBuilder.build(parts, complete: true))
        let averages = try XCTUnwrap(summary["samples"] as? [String: Any])
        XCTAssertEqual(try XCTUnwrap(averages["avgGroundContactTime"] as? Double), 266.666, accuracy: 1e-2)
        XCTAssertEqual(try XCTUnwrap(averages["avgVerticalOscillation"] as? Double), 9.133, accuracy: 1e-2)
        XCTAssertEqual(try XCTUnwrap(averages["avgVerticalRatio"] as? Double), 7.3, accuracy: 1e-4)
        XCTAssertEqual(try XCTUnwrap(averages["avgGroundContactBalance"] as? Double), 50.0, accuracy: 1e-4)
        XCTAssertEqual(averages["avgHangTimeMs"] as? Double, 120.0)

        let series = try XCTUnwrap(summary["dynamics"] as? [String: Any])
        XCTAssertEqual(series["start"] as? Int, Int(t0))
        XCTAssertEqual(series["stepSec"] as? Int, 60)
        XCTAssertEqual((series["gct"] as? [Any])?.compactMap { $0 as? Double }, [250.0, 300.0])
        XCTAssertEqual((series["vo"] as? [Any])?.first as? Double, 8.7)
        XCTAssertTrue((series["vr"] as? [Any])?.last is NSNull)

        let none = WorkoutParts(totals: try totalsResponse { $0.put(0x14, byte: 1) })
        none.samples = [sample(cadence: 170)]
        let plain = try json(WorkoutBuilder.build(none, complete: true))
        XCTAssertNil(plain["dynamics"])
        XCTAssertNil((plain["samples"] as? [String: Any])?["avgVerticalOscillation"])
    }
}
