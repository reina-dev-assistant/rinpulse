// Port of Notifications.java (service 0x02), the watch-side switch only: the phone-side forwarding (notification text, icons, replies) is
// Android's NotificationForwarder; on iOS the watch reads the iPhone's notifications itself (ANCS) once this switch is on. Plus 02/0B, the
// per-app switch list, which Gadgetbridge does not have (layout from Huawei Health's own wire schema).
import Foundation

public enum Notifications {
    public static let id: UInt8 = 0x02

    /// SetNotificationRequest (02/04): the watch's own "show notifications" switch, GB `PREF_NOTIFICATION_ENABLE`.
    public enum NotificationState {
        public static let id: UInt8 = 0x04

        public static func request(enabled: Bool) -> HuaweiPacket {
            var inner = HuaweiTLV()
            inner.put(0x02, bool: enabled)
            inner.put(0x03, bool: enabled)
            var tlv = HuaweiTLV()
            tlv.put(0x81, tlv: inner)
            return HuaweiPacket(serviceId: Notifications.id, commandId: id, tlv: tlv)
        }
    }

    /// App switch list (02/0B): one entry per app, `{app_id: string, notification_enable: u8}`, the same shape in both directions. Not in
    /// Gadgetbridge (it filters on the phone). Layout from Huawei Health 17.0.8.300 (`serviceId_2.json`; `nlz.sendAllSubSwitchStatusToDevice`):
    /// `81 { 82 { 03 <app id, UTF-8>, 04 <one byte> } ... }`. Which byte means "off", and which id strings the watch matches, is NOT settled
    /// (docs/ios-notification-app-switches.md): the packet carries the byte as given, the choice lives in `NotificationAppFilter`.
    public enum AppSwitches {
        public static let id: UInt8 = 0x0B

        public struct Entry: Equatable, Sendable {
            public var appId: String
            public var value: UInt8

            public init(appId: String, value: UInt8) {
                self.appId = appId
                self.value = value
            }
        }

        public static func request(entries: [Entry]) -> HuaweiPacket {
            var list = HuaweiTLV()
            for entry in entries {
                var app = HuaweiTLV()
                app.put(0x03, string: entry.appId)
                app.put(0x04, byte: entry.value)
                list.put(0x82, tlv: app)
            }
            var tlv = HuaweiTLV()
            tlv.put(0x81, tlv: list)
            return HuaweiPacket(serviceId: Notifications.id, commandId: id, tlv: tlv)
        }

        /// The watch's answer, or its own report of an app switched off on the watch (same tags). An answer with nothing in it is fine: the
        /// result code (tag 0x7F, 100000 is "ok" in the neighbouring 02/04 answer) is kept when present, never required.
        public struct Response: PacketResponse {
            public var entries: [Entry] = []
            public var resultCode: Int32?

            public init(packet: HuaweiPacket) throws {
                guard let tlv = packet.tlv else { return }
                try PacketsJava.parsing("AppSwitches") {
                    if tlv.contains(0x81) {
                        for app in try tlv.object(0x81).objects(0x82) {
                            guard app.contains(0x03), app.contains(0x04) else { continue }
                            entries.append(Entry(appId: try app.string(0x03), value: UInt8(bitPattern: try app.byte(0x04))))
                        }
                    }
                    if tlv.contains(0x7F) { resultCode = try tlv.asInteger(0x7F) }
                }
            }
        }
    }
}
