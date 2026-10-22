// Port of the Workout.java packets (service 0x17) the workout sync uses: count, totals, data, pace, swim segments, SpO2, capability and
// sections. Java `byte`/`short` fields keep their signed Swift types (`Int8`/`Int16`) and their defaults (-1 means "not sent"); parse
// failures follow the Java exception class like the other packet files (MissingTag, LengthMismatch: `PacketError`; ArrayIndexOutOfBounds,
// BufferUnderflow: plain ERR_PROTOCOL).
import Foundation

public enum Workout {
    public static let id: UInt8 = 0x17

    /// `huaweiIdToKey`: the totals' additional values the watch sends as strings.
    static let huaweiIdToKey: [Int32: String] = [300_010_027: "waterType", 300_010_024: "avgDepth", 300_010_037: "postureType", 300_010_035: "lthrHr", 300_010_036: "lthrPace"]

    /// A request whose TLV is built by `body`; Java default flags (encrypted, sliced).
    private static func request(_ command: UInt8, _ body: (inout HuaweiTLV) -> Void) -> HuaweiPacket {
        var tlv = HuaweiTLV()
        body(&tlv)
        return HuaweiPacket(serviceId: id, commandId: command, tlv: tlv)
    }

    private static func container(_ body: (inout HuaweiTLV) -> Void) -> HuaweiTLV {
        var inner = HuaweiTLV()
        body(&inner)
        var tlv = HuaweiTLV()
        tlv.put(0x81, tlv: inner)
        return tlv
    }

    // MARK: WorkoutCount (17/07)

    public enum WorkoutCount {
        public static let id: UInt8 = 0x07

        public static func request(start: Int32, end: Int32) -> HuaweiPacket {
            HuaweiPacket(serviceId: Workout.id, commandId: id, tlv: Workout.container {
                $0.put(0x03, int: start)
                $0.put(0x04, int: end)
            })
        }

        public struct Response: PacketResponse {
            public struct WorkoutNumbers: Equatable {
                public var rawData: Bytes = []
                public var workoutNumber: Int16 = 0
                public var dataCount: Int16 = 0
                public var paceCount: Int16 = 0
                public var segmentsCount: Int16 = 0
                public var spO2Count: Int16 = 0
                public var sectionsCount: Int16 = 0
                /// 1 when the watch holds a `_gps.bin` / `_pdr.bin` for the workout.
                public var trajectoriesData: Int8 = 0
                public var divingData: Int8 = 0
            }

            public var count: Int16 = 0
            /// nil on an error answer, like the Java field.
            public var workoutNumbers: [WorkoutNumbers]?
            public var error: Int32?

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "WorkoutCount")
                try PacketsJava.parsing("WorkoutCount") {
                    if tlv.contains(0x7f) {
                        error = try tlv.asInteger(0x7f)
                        count = 0
                        return
                    }
                    let container = try tlv.object(0x81)
                    count = try container.short(0x02)
                    var numbers = [WorkoutNumbers]()
                    workoutNumbers = numbers
                    if count == 0 { return }
                    for sub in try container.objects(0x85) {
                        var n = WorkoutNumbers()
                        n.rawData = sub.serialize()
                        n.workoutNumber = try sub.short(0x06)
                        n.dataCount = try sub.short(0x07)
                        n.paceCount = try sub.short(0x08)
                        if sub.contains(0x09) { n.segmentsCount = try sub.short(0x09) }
                        if sub.contains(0x0c) { n.spO2Count = try sub.short(0x0c) }
                        if sub.contains(0x0d) { n.sectionsCount = try sub.short(0x0d) }
                        if sub.contains(0x0e) { n.trajectoriesData = try sub.byte(0x0e) }
                        if sub.contains(0x0f) { n.divingData = try sub.byte(0x0f) }
                        numbers.append(n)
                    }
                    workoutNumbers = numbers
                }
            }
        }
    }

    // MARK: WorkoutTotals (17/08)

    public enum WorkoutTotals {
        public static let id: UInt8 = 0x08

        public static func request(number: Int16) -> HuaweiPacket {
            HuaweiPacket(serviceId: Workout.id, commandId: id, tlv: Workout.container { $0.put(0x02, short: number) })
        }

        public struct Response: PacketResponse {
            public var rawData: Bytes?
            public var error: Int32?

            public var number: Int16 = 0
            public var status: Int8 = -1
            public var startTime: Int32 = 0
            public var endTime: Int32 = 0
            public var calories: Int32 = -1
            public var distance: Int32 = -1
            public var stepCount: Int32 = -1
            public var totalTime: Int32 = -1
            public var duration: Int32 = -1
            public var type: Int8 = -1
            public var strokes: Int16 = -1
            public var avgStrokeRate: Int16 = -1
            /// In cm.
            public var poolLength: Int16 = -1
            public var laps: Int16 = -1
            public var avgSwolf: Int16 = -1

            public var maxAltitude: Int32?
            public var minAltitude: Int32?
            public var elevationGain: Int32?
            public var elevationLoss: Int32?

            public var workoutLoad: Int32 = 0
            public var workoutAerobicEffect: Int32 = 0
            public var workoutAnaerobicEffect: Int8 = -1
            public var recoveryTime: Int16 = 0

            public var minHeartRatePeak: Int8 = 0
            public var maxHeartRatePeak: Int8 = 0

            public var recoveryHeartRates: Bytes?

            public var swimType: Int8 = -1

            public var maxMET: Int32 = 0

            public var hrZoneType: Int8 = -1

            public var runPaceZone1Min: Int16 = -1
            public var runPaceZone2Min: Int16 = -1
            public var runPaceZone3Min: Int16 = -1
            public var runPaceZone4Min: Int16 = -1
            public var runPaceZone5Min: Int16 = -1
            public var runPaceZone5Max: Int16 = -1

            public var runPaceZone1Time: Int16 = -1
            public var runPaceZone2Time: Int16 = -1
            public var runPaceZone3Time: Int16 = -1
            public var runPaceZone4Time: Int16 = -1
            public var runPaceZone5Time: Int16 = -1

            public var algType: Int8 = 0

            public var trainingPoints: Int32 = -1

            public var longestStreak: Int32 = -1
            public var tripped: Int32 = -1

            public var additionalValues: [String: String] = [:]

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "WorkoutTotals")
                try PacketsJava.parsing("WorkoutTotals") {
                    if tlv.contains(0x7f) {
                        error = try tlv.asInteger(0x7f)
                        return
                    }
                    let c = try tlv.object(0x81)

                    rawData = c.serialize()
                    number = try c.short(0x02)
                    if c.contains(0x03) { status = try c.byte(0x03) }
                    startTime = try c.int(0x04)
                    endTime = try c.int(0x05)

                    if c.contains(0x06) { calories = try c.int(0x06) }
                    if c.contains(0x07) { distance = try c.int(0x07) }
                    if c.contains(0x08) { stepCount = try c.int(0x08) }
                    if c.contains(0x09) { totalTime = try c.int(0x09) }
                    if c.contains(0x0b) { elevationGain = try c.int(0x0b) }
                    if c.contains(0x0c) {
                        let hr = try c.bytes(0x0c)
                        guard hr.count >= 2 else {
                            throw PacketsJava.runtimeFailure("WorkoutTotals", "ArrayIndexOutOfBoundsException: heart rate peaks of \(hr.count) bytes")
                        }
                        minHeartRatePeak = Int8(bitPattern: hr[0])
                        maxHeartRatePeak = Int8(bitPattern: hr[1])
                    }
                    if c.contains(0x0d) { workoutLoad = try c.int(0x0d) }
                    if c.contains(0x0e) { workoutAerobicEffect = try c.int(0x0e) }
                    if c.contains(0x10) { maxMET = try c.int(0x10) }
                    if c.contains(0x11) { recoveryTime = try c.short(0x11) }
                    if c.contains(0x12) { duration = try c.int(0x12) }
                    if c.contains(0x14) { type = try c.byte(0x14) }
                    if c.contains(0x15) { swimType = try c.byte(0x15) }
                    if c.contains(0x16) { strokes = try c.short(0x16) }
                    if c.contains(0x17) { avgStrokeRate = try c.short(0x17) }
                    if c.contains(0x18) { poolLength = try c.short(0x18) }
                    if c.contains(0x19) { laps = try c.short(0x19) }
                    if c.contains(0x1a) { avgSwolf = try c.short(0x1a) }
                    if c.contains(0x1b) { elevationLoss = try c.int(0x1b) }
                    if c.contains(0x1c) { maxAltitude = try c.int(0x1c) }
                    if c.contains(0x1d) { minAltitude = try c.int(0x1d) }
                    if c.contains(0x20) { workoutAnaerobicEffect = try c.byte(0x20) }
                    if c.contains(0x24) { hrZoneType = try c.byte(0x24) }
                    if c.contains(0x50) { runPaceZone1Min = try c.short(0x50) }
                    if c.contains(0x51) { runPaceZone2Min = try c.short(0x51) }
                    if c.contains(0x52) { runPaceZone3Min = try c.short(0x52) }
                    if c.contains(0x53) { runPaceZone4Min = try c.short(0x53) }
                    if c.contains(0x54) { runPaceZone5Min = try c.short(0x54) }
                    if c.contains(0x55) { runPaceZone5Max = try c.short(0x55) }
                    if c.contains(0x56) { runPaceZone1Time = try c.short(0x56) }
                    if c.contains(0x57) { runPaceZone2Time = try c.short(0x57) }
                    if c.contains(0x58) { runPaceZone3Time = try c.short(0x58) }
                    if c.contains(0x59) { runPaceZone4Time = try c.short(0x59) }
                    if c.contains(0x5a) { runPaceZone5Time = try c.short(0x5a) }
                    if c.contains(0x5b) { longestStreak = try c.asInteger(0x5b) }
                    if c.contains(0x5c) { tripped = try c.asInteger(0x5c) }
                    if c.contains(0x5d) { algType = try c.byte(0x5d) }
                    if c.contains(0x63) { trainingPoints = Int32(try c.short(0x63)) }
                    if c.contains(0x66) { recoveryHeartRates = try c.bytes(0x66) }

                    for sub in try c.objects(0xe7) where sub.contains(0x68) && sub.contains(0x69) {
                        let tag = try sub.int(0x68)
                        let value = try sub.string(0x69)
                        if let key = Workout.huaweiIdToKey[tag] { additionalValues[key] = value }
                    }
                }
            }
        }
    }

    // MARK: WorkoutData (17/0A)

    public enum WorkoutData {
        public static let id: UInt8 = 0x0a

        public static func request(workoutNumber: Int16, dataNumber: Int16, newSteps: Bool) -> HuaweiPacket {
            HuaweiPacket(serviceId: Workout.id, commandId: id, tlv: Workout.container {
                $0.put(0x02, short: workoutNumber)
                $0.put(0x03, short: dataNumber)
                if newSteps { $0.put(0x06, byte: 1) }
                $0.put(0x07)
            })
        }

        public struct Response: PacketResponse {
            public struct Header: Equatable {
                public var workoutNumber: Int16
                public var dataNumber: Int16
                public var timestamp: Int32
                public var interval: Int8
                public var dataCount: Int16
                public var dataLength: Int8
                public var bitmap: Int16
            }

            public struct Data: Equatable {
                /// The whole TLV when something unknown was met, so it can be parsed again later.
                public var unknownData: Bytes?

                public var heartRate: Int8 = -1
                public var speed: Int16 = -1
                public var stepRate: Int8 = -1

                public var cadence: Int16 = -1
                public var stepLength: Int16 = -1
                public var groundContactTime: Int16 = -1
                public var impact: Int8 = -1
                public var swingAngle: Int16 = -1
                public var foreFootLanding: Int8 = -1
                public var midFootLanding: Int8 = -1
                public var backFootLanding: Int8 = -1
                public var eversionAngle: Int8 = -1
                public var hangTime: Int16 = -1
                public var impactHangRate: Int16 = -1
                public var rideCadence: Int8 = -1
                public var ap: Float = 0
                public var vo: Float = 0
                public var gtb: Float = 0
                public var vr: Float = 0
                public var ceiling: Int8 = -1
                public var temp: Int8 = -1
                public var spo2: Int8 = -1
                public var cns: Int16 = -1

                public var swolf: Int16 = -1
                public var strokeRate: Int16 = -1

                public var calories: Int16 = -1
                public var cyclingPower: Int16 = -1
                public var frequency: Int16 = -1
                /// Decimetres.
                public var altitude: Int32?

                /// Calculated timestamp for this data point.
                public var timestamp: Int32 = -1
            }

            static let bitmapLengths: [Int] = [1, 2, 1, 2, 2, 4, -1, 2, 2, 2]
            static let innerBitmapLengths: [Int] = [2, 2, 2, 1, 2, 1, 1, 1, 1, 2, 2, 1, 2, 2, 2, 2, 1, 1, 1, 2, 2, 1, 2]

            public var error: Int32?

            public var workoutNumber: Int16 = 0
            public var dataNumber: Int16 = 0
            public var rawHeader: Bytes = []
            public var rawData: Bytes = []
            public var innerBitmap: Int32 = 0
            public var innerDataLength: Int32 = 0

            public var header: Header?
            public var dataList: [Data] = []

            public init(packet: HuaweiPacket, isAW: Bool) throws {
                let tlv = try PacketsJava.tlv(of: packet, "WorkoutData")
                try PacketsJava.parsing("WorkoutData") { try parse(tlv, isAW: isAW) }
            }

            /// `PacketResponse` entry point for a caller without the link parameters; the AW defaults are off.
            public init(packet: HuaweiPacket) throws {
                try self.init(packet: packet, isAW: false)
            }

            private mutating func parse(_ tlv: HuaweiTLV, isAW: Bool) throws {
                if tlv.contains(0x7f) {
                    error = try tlv.asInteger(0x7f)
                    return
                }
                let container = try tlv.object(0x81)

                workoutNumber = try container.short(0x02)
                dataNumber = try container.short(0x03)
                rawHeader = try container.bytes(0x04)
                rawData = try container.bytes(0x05)

                // The bitmap 0x01FF and length 13 defaults are only true for AW devices.
                if container.contains(0x08) {
                    innerDataLength = try container.asInteger(0x08)
                } else if isAW {
                    innerDataLength = 13
                }
                if container.contains(0x09) {
                    innerBitmap = try container.asInteger(0x09)
                } else if isAW {
                    innerBitmap = 0x01FF
                }

                if rawHeader.count != 14 { throw PacketError.lengthMismatch("Workout data header length mismatch.") }

                var buf = WorkoutBuffer(rawHeader)
                let h = Header(
                    workoutNumber: try buf.short(), dataNumber: try buf.short(), timestamp: try buf.int(), interval: try buf.byte(),
                    dataCount: try buf.short(), dataLength: try buf.byte(), bitmap: try buf.short()
                )
                header = h

                if Int(h.dataCount) * Int(h.dataLength) != rawData.count {
                    throw PacketError.lengthMismatch("Workout data length mismatch with header.")
                }

                var calcInnerDataLength = 0
                for (i, length) in Response.innerBitmapLengths.enumerated() where innerBitmap & (1 << Int32(i)) != 0 {
                    calcInnerDataLength += length
                }
                if calcInnerDataLength > Int(innerDataLength) {
                    throw PacketError.lengthMismatch("Workout data innerDataLength incorrect")
                }

                var dataLength = 0
                for (i, length) in Response.bitmapLengths.enumerated() where Int(h.bitmap) & (1 << i) != 0 {
                    dataLength += i == 6 ? Int(innerDataLength) : length
                }
                dataLength *= Int(h.dataCount)
                if dataLength != rawData.count {
                    throw PacketError.lengthMismatch("Workout data length mismatch with bitmap.")
                }

                let unknownMarker = tlv.serialize()
                dataList = []
                buf = WorkoutBuffer(rawData)
                var i: Int16 = 0
                while i < h.dataCount {
                    var data = Data()
                    data.timestamp = h.timestamp &+ Int32(h.interval) &* Int32(i)
                    for j in 0..<Response.bitmapLengths.count where Int(h.bitmap) & (1 << j) != 0 {
                        switch j {
                        case 0: data.heartRate = try buf.byte()
                        case 1: data.speed = try buf.short()
                        case 2: data.stepRate = try buf.byte()
                        case 3: data.swolf = try buf.short()
                        case 4: data.strokeRate = try buf.short()
                        case 5: data.altitude = try buf.int()
                        case 6:
                            if innerDataLength > 0 {
                                let inner = try buf.bytes(Int(innerDataLength))
                                try parseInner(inner, into: &data, unknownMarker: unknownMarker)
                            }
                        case 7: data.calories = try buf.short()
                        case 8: data.frequency = try buf.short()
                        default: data.cyclingPower = try buf.short()
                        }
                    }
                    dataList.append(data)
                    i += 1
                }
            }

            private func parseInner(_ innerRaw: Bytes, into data: inout Data, unknownMarker: Bytes) throws {
                var buf = WorkoutBuffer(innerRaw)
                for k in 0..<Response.innerBitmapLengths.count where innerBitmap & (1 << Int32(k)) != 0 {
                    switch k {
                    case 0: data.cadence = try buf.short()
                    case 1: data.stepLength = try buf.short()
                    case 2: data.groundContactTime = try buf.short()
                    case 3: data.impact = try buf.byte()
                    case 4: data.swingAngle = try buf.short()
                    case 5: data.foreFootLanding = try buf.byte()
                    case 6: data.midFootLanding = try buf.byte()
                    case 7: data.backFootLanding = try buf.byte()
                    case 8: data.eversionAngle = try buf.byte()
                    case 9: data.hangTime = try buf.short()
                    case 10: data.impactHangRate = try buf.short()
                    case 11: data.rideCadence = try buf.byte()
                    case 12: data.ap = Float(try buf.short()) / 10.0
                    case 13: data.vo = Float(try buf.short()) / 10.0
                    case 14: data.gtb = Float(try buf.short()) / 100.0
                    case 15: data.vr = Float(try buf.short()) / 10.0
                    case 16: data.ceiling = try buf.byte()
                    case 17: data.temp = try buf.byte()
                    case 18: data.spo2 = try buf.byte()
                    case 19: data.cns = try buf.short()
                    default: break // 20...22 (cycle analog power, unknown, cycle analog cadence) are not read, as in Java
                    }
                }
                if buf.remaining > 0 { data.unknownData = unknownMarker }
            }
        }
    }

    // MARK: WorkoutPace (17/0C)

    public enum WorkoutPace {
        public static let id: UInt8 = 0x0c

        public static func request(workoutNumber: Int16, paceNumber: Int16) -> HuaweiPacket {
            HuaweiPacket(serviceId: Workout.id, commandId: id, tlv: Workout.container {
                $0.put(0x02, short: workoutNumber)
                $0.put(0x08, short: paceNumber)
            })
        }

        public struct Response: PacketResponse {
            public struct Block: Equatable {
                public var distance: Int16 = -1
                public var type: Int8 = -1
                public var pace: Int32 = -1
                public var pointIndex: Int16 = 0
                public var correction: Int16 = 0
                public var hasCorrection = false

                public init() {}
            }

            public var error: Int32?
            public var workoutNumber: Int16 = 0
            public var paceNumber: Int16 = 0
            public var blocks: [Block] = []

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "WorkoutPace")
                try PacketsJava.parsing("WorkoutPace") {
                    if tlv.contains(0x7f) {
                        error = try tlv.asInteger(0x7f)
                        return
                    }
                    let c = try tlv.object(0x81)
                    workoutNumber = try c.short(0x02)
                    paceNumber = try c.short(0x08)
                    for blockTlv in try c.objects(0x83) {
                        var b = Block()
                        b.distance = try blockTlv.short(0x04)
                        b.type = try blockTlv.byte(0x05)
                        b.pace = try blockTlv.int(0x06)
                        if blockTlv.contains(0x07) { b.pointIndex = try blockTlv.short(0x07) }
                        if blockTlv.contains(0x09) {
                            b.hasCorrection = true
                            b.correction = try blockTlv.short(0x09)
                        }
                        blocks.append(b)
                    }
                }
            }
        }
    }

    // MARK: WorkoutSwimSegments (17/0E)

    public enum WorkoutSwimSegments {
        public static let id: UInt8 = 0x0e

        public static func request(workoutNumber: Int16, segmentNumber: Int16) -> HuaweiPacket {
            HuaweiPacket(serviceId: Workout.id, commandId: id, tlv: Workout.container {
                $0.put(0x02, short: workoutNumber)
                $0.put(0x08, short: segmentNumber)
            })
        }

        public struct Response: PacketResponse {
            public struct Block: Equatable {
                public var distance: Int16 = -1
                public var type: Int8 = -1
                public var pace: Int32 = -1
                public var pointIndex: Int16 = 0
                public var segment: Int16 = -1
                public var swimType: Int8 = -1
                public var strokes: Int16 = -1
                public var avgSwolf: Int16 = -1
                public var time: Int32 = -1

                public init() {}
            }

            public var error: Int32?
            public var workoutNumber: Int16 = 0
            public var segmentNumber: Int16 = 0
            public var blocks: [Block] = []

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "WorkoutSwimSegments")
                try PacketsJava.parsing("WorkoutSwimSegments") {
                    if tlv.contains(0x7f) {
                        error = try tlv.asInteger(0x7f)
                        return
                    }
                    let c = try tlv.object(0x81)
                    workoutNumber = try c.short(0x02)
                    segmentNumber = try c.short(0x08)
                    for blockTlv in try c.objects(0x83) {
                        var b = Block()
                        b.distance = try blockTlv.short(0x04)
                        b.type = try blockTlv.byte(0x05)
                        b.pace = try blockTlv.int(0x06)
                        if blockTlv.contains(0x07) { b.pointIndex = try blockTlv.short(0x07) }
                        if blockTlv.contains(0x09) { b.segment = try blockTlv.short(0x09) }
                        if blockTlv.contains(0x0a) { b.swimType = try blockTlv.byte(0x0a) }
                        if blockTlv.contains(0x0b) { b.strokes = try blockTlv.short(0x0b) }
                        if blockTlv.contains(0x0c) { b.avgSwolf = try blockTlv.short(0x0c) }
                        if blockTlv.contains(0x0d) { b.time = try blockTlv.int(0x0d) }
                        blocks.append(b)
                    }
                }
            }
        }
    }

    // MARK: WorkoutSpO2 (17/14)

    public enum WorkoutSpO2 {
        public static let id: UInt8 = 0x14

        public static func request(workoutNumber: Int16, spO2Number: Int16) -> HuaweiPacket {
            Workout.request(id) {
                $0.put(0x01, short: workoutNumber)
                $0.put(0x02, short: spO2Number)
                $0.put(0x03)
            }
        }

        public struct Response: PacketResponse {
            public struct Block: Equatable {
                public var interval: Int32 = -1
                public var value: Int32 = -1

                public init() {}
            }

            public var error: Int32?
            public var spO2Number1: Int16 = 0
            public var spO2Number2: Int16 = 0
            public var blocks: [Block] = []

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "WorkoutSpO2")
                try PacketsJava.parsing("WorkoutSpO2") {
                    if tlv.contains(0x7f) {
                        error = try tlv.asInteger(0x7f)
                        return
                    }
                    spO2Number1 = try tlv.short(0x01)
                    spO2Number2 = try tlv.short(0x02)
                    let c = try tlv.object(0x83)
                    for blockTlv in try c.objects(0x84) {
                        var b = Block()
                        if blockTlv.contains(0x05) { b.interval = try blockTlv.asInteger(0x05) }
                        if blockTlv.contains(0x06) { b.value = try blockTlv.asInteger(0x06) }
                        blocks.append(b)
                    }
                }
            }
        }
    }

    // MARK: WorkoutCapability (17/15)

    public enum WorkoutCapability {
        public static let id: UInt8 = 0x15

        public static func request() -> HuaweiPacket {
            Workout.request(id) { $0.put(0x01) }
        }

        public struct Response: PacketResponse {
            public var supportNewStep = false

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "WorkoutCapability")
                try PacketsJava.parsing("WorkoutCapability") {
                    if tlv.contains(0x01) {
                        let flags = try tlv.asInteger(0x01)
                        supportNewStep = (flags & 2) == 2
                    }
                }
            }
        }
    }

    // MARK: WorkoutSections (17/16)

    public enum WorkoutSections {
        public static let id: UInt8 = 0x16

        public static func request(workoutNumber: Int16, additionalDataNumber: Int16) -> HuaweiPacket {
            Workout.request(id) {
                $0.put(0x01, short: workoutNumber)
                $0.put(0x02, short: additionalDataNumber)
                $0.put(0x03)
            }
        }

        public struct Response: PacketResponse {
            public struct Block: Equatable {
                public var num: Int32 = -1
                public var time: Int64 = -1
                public var distance: Int64 = -1
                public var pace: Int32 = -1
                public var heartRate: Int32 = -1
                public var cadence: Int32 = -1
                public var stepLength: Int32 = -1
                public var totalRise: Int64 = -1
                public var totalDescend: Int64 = -1
                public var groundContactTime: Int32 = -1
                public var groundImpact: Int32 = -1
                public var swingAngle: Int32 = -1
                public var eversion: Int32 = -1

                public var avgCadence: Int32 = -1
                public var intervalTrainingType: Int32 = -1
                public var divingMaxDepth: Int32 = -1
                public var divingUnderwaterTime: Int32 = -1
                public var divingBreakTime: Int32 = -1

                public init() {}
            }

            public var error: Int32?
            public var workoutId: Int16 = 0
            public var number: Int16 = 0
            public var blocks: [Block] = []

            public init(packet: HuaweiPacket) throws {
                let tlv = try PacketsJava.tlv(of: packet, "WorkoutSections")
                try PacketsJava.parsing("WorkoutSections") {
                    if tlv.contains(0x7f) {
                        error = try tlv.asInteger(0x7f)
                        return
                    }
                    workoutId = try tlv.short(0x01)
                    number = try tlv.short(0x02)
                    let c = try tlv.object(0x83)
                    for t in try c.objects(0x84) {
                        var b = Block()
                        if t.contains(0x05) { b.num = try t.asInteger(0x05) }
                        if t.contains(0x06) { b.time = try t.asLong(0x06) }
                        if t.contains(0x07) { b.distance = try t.asLong(0x07) }
                        if t.contains(0x08) { b.pace = try t.asInteger(0x08) }
                        if t.contains(0x09) { b.heartRate = try t.asInteger(0x09) }
                        if t.contains(0x0a) { b.cadence = try t.asInteger(0x0a) }
                        if t.contains(0x0b) { b.stepLength = try t.asInteger(0x0b) }
                        if t.contains(0x0c) { b.totalRise = try t.asLong(0x0c) }
                        if t.contains(0x0d) { b.totalDescend = try t.asLong(0x0d) }
                        if t.contains(0x0e) { b.groundContactTime = try t.asInteger(0x0e) }
                        if t.contains(0x0f) { b.groundImpact = try t.asInteger(0x0f) }
                        if t.contains(0x10) { b.swingAngle = try t.asInteger(0x10) }
                        if t.contains(0x11) { b.eversion = try t.asInteger(0x11) }
                        if t.contains(0x22) { b.avgCadence = try t.asInteger(0x22) }
                        if t.contains(0x23) { b.intervalTrainingType = try t.asInteger(0x23) }
                        if t.contains(0x28) { b.divingMaxDepth = try t.asInteger(0x28) }
                        if t.contains(0x29) { b.divingUnderwaterTime = try t.asInteger(0x29) }
                        if t.contains(0x2a) { b.divingBreakTime = try t.asInteger(0x2a) }
                        blocks.append(b)
                    }
                }
            }
        }
    }
}

/// Java `ByteBuffer.wrap(bytes)` reads (big-endian) for the workout parsers; a read past the end is a `BufferUnderflowException`, an ERR_PROTOCOL
/// like every Java runtime failure inside `parseTlv`.
struct WorkoutBuffer {
    private let array: Bytes
    private(set) var position = 0

    init(_ array: Bytes) { self.array = array }

    var remaining: Int { array.count - position }

    private func need(_ n: Int) throws {
        if remaining < n {
            throw PacketsJava.runtimeFailure("Workout", "BufferUnderflowException: need \(n) bytes at \(position), have \(array.count)")
        }
    }

    mutating func byte() throws -> Int8 {
        try need(1)
        defer { position += 1 }
        return Int8(bitPattern: array[position])
    }

    mutating func short() throws -> Int16 {
        try need(2)
        defer { position += 2 }
        return Int16(bitPattern: array.u16be(position))
    }

    mutating func int() throws -> Int32 {
        try need(4)
        defer { position += 4 }
        return Int32(bitPattern: array.u32be(position))
    }

    mutating func bytes(_ count: Int) throws -> Bytes {
        try need(count)
        defer { position += count }
        return Array(array[position..<position + count])
    }
}
