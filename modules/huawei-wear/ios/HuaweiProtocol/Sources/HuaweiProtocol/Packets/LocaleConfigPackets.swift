// Port of LocaleConfig.java (service 0x0C): the phone's language and unit system. Tag 0x03 (the script) is what Huawei Health 17.0.8.300 adds
// when ExpandCapability 57 is set.
import Foundation

public enum LocaleConfig {
    public static let id: UInt8 = 0x0C

    public enum SetLanguageSetting {
        public static let id: UInt8 = 0x01

        /// `locale` is the UTF-8 of the `xx-YY` tag, `measurement` a `MeasurementSystem` byte, `script` the UTF-8 script or nil to leave tag 0x03 out.
        public static func request(locale: Bytes, measurement: UInt8, script: Bytes?) -> HuaweiPacket {
            var tlv = HuaweiTLV()
            tlv.put(0x01, bytes: locale)
            tlv.put(0x02, byte: measurement)
            if let script { tlv.put(0x03, bytes: script) }
            return HuaweiPacket(serviceId: LocaleConfig.id, commandId: id, tlv: tlv)
        }
    }

    public enum MeasurementSystem {
        public static let metric: UInt8 = 0x00
        public static let imperial: UInt8 = 0x01
    }
}
