import XCTest
@testable import HuaweiProtocol

/// What a refetch of running dynamics writes into a stored summary: `RunDynamics.merge` on the JSON string. Mirrors Kotlin's
/// `WorkoutRefetchMergeTest` (the database half of that one is covered by the app's `WorkoutStoreTests`).
final class RunDynamicsMergeTests: XCTestCase {
    private func form(_ ts: Int32, gct: Int16 = -1, vo: Float = 0, vr: Float = 0, gtb: Float = 0, hang: Int16 = -1) -> Workout.WorkoutData.Response.Data {
        var d = Workout.WorkoutData.Response.Data()
        d.timestamp = ts
        d.groundContactTime = gct
        d.vo = vo
        d.vr = vr
        d.gtb = gtb
        d.hangTime = hang
        return d
    }

    private func result(series: Bool = true) throws -> RunDynamics.Result {
        let t0: Int32 = 1_700_000_000
        var samples = [form(t0, gct: 240, vo: 8.4, vr: 7.1, gtb: 50.2, hang: 120), form(t0 + 70, gct: 260, vo: 9.0, vr: 7.5, gtb: 49.8, hang: 130)]
        if !series { samples = [form(t0, gct: 240, vo: 8.4), form(t0 + 10, gct: 260, vo: 9.0)] }
        return try XCTUnwrap(RunDynamics.of(samples))
    }

    /// A run synced before the dynamics were kept: a contact-time mean that counted zero readings, and the usual fields.
    private let before = """
    {"kind":"RUNNING","number":5,"gps":"ok","dataSamples":300,"avgSpeed":2.7,"paceBlocks":[{"type":0,"pace":330}],
     "samples":{"avgHr":151.5,"avgCadence":168.0,"avgGroundContactTime":131.4,"maxSpeed":4.1},"rawTotals":"0a/0b"}
    """

    private func object(_ json: String) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
    }

    func testMergeReplacesTheRunningFormAndKeepsEveryOtherField() throws {
        let merged = try XCTUnwrap(RunDynamics.merge(summaryJson: before, result: try result()))

        XCTAssertTrue(merged.changed)
        let summary = try object(merged.json)
        let samples = try XCTUnwrap(summary["samples"] as? [String: Any])
        XCTAssertEqual(try XCTUnwrap(samples["avgGroundContactTime"] as? Double), 250.0, accuracy: 1e-9)
        XCTAssertEqual(try XCTUnwrap(samples["avgVerticalOscillation"] as? Double), 8.7, accuracy: 1e-5)
        XCTAssertEqual(try XCTUnwrap(samples["avgHangTimeMs"] as? Double), 125.0, accuracy: 1e-9)
        XCTAssertEqual((summary["dynamics"] as? [String: Any])?["stepSec"] as? Int, 60)
        // The rest is what it was.
        let original = try object(before)
        XCTAssertEqual(try XCTUnwrap(samples["avgHr"] as? Double), 151.5, accuracy: 1e-9)
        XCTAssertEqual(try XCTUnwrap(samples["avgCadence"] as? Double), 168.0, accuracy: 1e-9)
        XCTAssertEqual(try XCTUnwrap(samples["maxSpeed"] as? Double), 4.1, accuracy: 1e-9)
        for key in ["kind", "gps", "rawTotals"] { XCTAssertEqual(summary[key] as? String, original[key] as? String) }
        for key in ["number", "dataSamples"] { XCTAssertEqual(summary[key] as? Int, original[key] as? Int) }
        XCTAssertEqual(summary["avgSpeed"] as? Double, original["avgSpeed"] as? Double)
        XCTAssertEqual((summary["paceBlocks"] as? [[String: Any]])?.first?["pace"] as? Int, 330)
        XCTAssertEqual(Set(summary.keys), Set(original.keys).union(["dynamics"]))
    }

    func testMergingTheSameReadingsAgainChangesNothing() throws {
        let first = try XCTUnwrap(RunDynamics.merge(summaryJson: before, result: try result()))

        let second = try XCTUnwrap(RunDynamics.merge(summaryJson: first.json, result: try result()))

        XCTAssertFalse(second.changed)
        let samples = try XCTUnwrap(try object(second.json)["samples"] as? [String: Any])
        XCTAssertEqual(try XCTUnwrap(samples["avgHr"] as? Double), 151.5, accuracy: 1e-9)
    }

    func testASummaryWithoutSamplesGetsThemAndAnOldSeriesIsDroppedWhenTheWatchGivesNone() throws {
        let bare = try XCTUnwrap(RunDynamics.merge(summaryJson: #"{"kind":"RUNNING"}"#, result: try result(series: false)))
        XCTAssertTrue(bare.changed)
        XCTAssertNil(try object(bare.json)["dynamics"])
        let samples = try XCTUnwrap(try object(bare.json)["samples"] as? [String: Any])
        XCTAssertEqual(try XCTUnwrap(samples["avgVerticalOscillation"] as? Double), 8.7, accuracy: 1e-5)

        let withSeries = try XCTUnwrap(RunDynamics.merge(summaryJson: before, result: try result()))
        XCTAssertNotNil(try object(withSeries.json)["dynamics"])
        let dropped = try XCTUnwrap(RunDynamics.merge(summaryJson: withSeries.json, result: try result(series: false)))
        XCTAssertTrue(dropped.changed)
        XCTAssertNil(try object(dropped.json)["dynamics"])
    }

    func testASummaryThatIsNotJsonIsNotMerged() throws {
        XCTAssertNil(RunDynamics.merge(summaryJson: "not json", result: try result()))
        XCTAssertNil(RunDynamics.merge(summaryJson: "[1,2]", result: try result()))
    }
}
