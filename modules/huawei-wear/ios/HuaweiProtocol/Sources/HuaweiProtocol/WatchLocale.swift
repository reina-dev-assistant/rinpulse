// Port of WatchLocale.kt and LanguageSender (WatchLanguage.kt): the language the watch is told (SetLanguageSetting, service 0x0C), as Huawei
// Health 17.0.8.300's LanguageUtil and Gadgetbridge's SetLanguageSettingRequest send it. Works on BCP-47 strings (`Locale.preferredLanguages`,
// the JS side's `id` / `en`) so it behaves the same on Linux, where the unit tests run.
import Foundation

public enum WatchLocale {
    /// ExpandCapability bit that makes Huawei Health add the script tag.
    public static let scriptCapability = 57

    /// What goes into one SetLanguageSetting: `tag` e.g. `in-ID`, `script` e.g. `Latn` or nil (tag left out).
    public struct Setting: Equatable, Sendable {
        public let tag: String
        public let script: String?

        public init(tag: String, script: String?) {
            self.tag = tag
            self.script = script
        }
    }

    /// Java's old codes, as Huawei Health's `CommonUtil.c(Locale)` maps them: Indonesian is `in` (not `id`), Hebrew `iw`, Yiddish `ji`.
    public static func legacyLanguage(_ language: String) -> String {
        let lower = language.trimmingCharacters(in: .whitespaces).lowercased()
        switch lower {
        case "id": return "in"
        case "he": return "iw"
        case "yi": return "ji"
        default: return lower
        }
    }

    /// For a language that carries no country (`id`, `en`): the country the watch's own table has for it.
    private static let defaultCountry = ["in": "ID", "en": "US", "zh": "CN", "ms": "MY"]

    /// A BCP-47 tag taken apart: language (2 or 3 letters), optional script (4 letters), optional region (2 letters or 3 digits).
    struct Parts: Equatable {
        var language: String
        var script: String?
        var region: String?
    }

    /// Whether `text` starts with a language (`id`, `en-US`, `zh_Hant_TW`): what the JS side may pin.
    public static func isLanguageTag(_ text: String) -> Bool { parts(text) != nil }

    /// nil when the text has no language (`und`, `!!`, empty), like `Locale.forLanguageTag(...).language.isEmpty` on the Kotlin side.
    static func parts(_ text: String) -> Parts? {
        let pieces = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "_", with: "-")
            .split(separator: "-", omittingEmptySubsequences: true).map(String.init)
        guard let first = pieces.first, (2...3).contains(first.count), first.allSatisfy({ $0.isASCII && $0.isLetter }) else { return nil }
        let language = first.lowercased()
        if language == "und" { return nil }
        var result = Parts(language: language, script: nil, region: nil)
        for piece in pieces.dropFirst() {
            if result.script == nil, result.region == nil, piece.count == 4, piece.allSatisfy({ $0.isASCII && $0.isLetter }) {
                result.script = piece.prefix(1).uppercased() + piece.dropFirst().lowercased()
            } else if result.region == nil, (piece.count == 2 && piece.allSatisfy({ $0.isASCII && $0.isLetter })) || (piece.count == 3 && piece.allSatisfy({ $0.isASCII && $0.isNumber })) {
                result.region = piece.uppercased()
            } else {
                break
            }
        }
        return result
    }

    /// `xx-YY`. Without ExpandCapability 57 Huawei Health's `CommonUtil.ab()` writes traditional Chinese outside Taiwan and Hong Kong as
    /// `zh-CHT`; with it the script goes into its own tag instead.
    static func tag(_ parts: Parts, scriptCapable: Bool) -> String {
        let language = legacyLanguage(parts.language).isEmpty ? "en" : legacyLanguage(parts.language)
        let country = parts.region ?? defaultCountry[language] ?? language.uppercased()
        if language == "zh", !scriptCapable, let script = parts.script, script.lowercased() != "hans", country != "TW", country != "HK" {
            return "zh-CHT"
        }
        return "\(language)-\(country)"
    }

    /// The setting to send: the language JoyoFit was pinned to in Settings (`pinned`, `id` or `en-US`), else the phone's language.
    public static func resolve(pinned: String?, phone: String, scriptCapable: Bool) -> Setting {
        let chosen = pinned.flatMap(parts) ?? parts(phone) ?? Parts(language: "en", script: nil, region: nil)
        return Setting(tag: tag(chosen, scriptCapable: scriptCapable), script: scriptCapable ? chosen.script : nil)
    }
}

/// SetLanguageSetting (service 0C, command 01): tells the watch the phone's language, only when the watch lists the command.
public enum LanguageSender {
    public static func supported(_ caps: DeviceCaps) -> Bool {
        caps.supports(Int(LocaleConfig.id), Int(LocaleConfig.SetLanguageSetting.id))
    }

    /// The phone's first language, `en-US` when iOS lists none.
    public static func phoneLanguage() -> String { Locale.preferredLanguages.first ?? "en-US" }

    /// Sends what `WatchLocale.resolve` makes of `pinned` and the phone language; true when the watch acknowledged. JoyoFit has no unit
    /// setting and shows kilometres, so the unit tag is always metric.
    @discardableResult
    public static func send(
        session: HuaweiSession, caps: DeviceCaps, log: @escaping LogSink, pinned: String?, phone: String, timeoutMs: Int = Timeouts.initMs
    ) async throws -> Bool {
        guard supported(caps) else {
            log(LogEntry(.info, "LanguageSetting: the watch does not list 0C/01, not sent"))
            return false
        }
        let setting = WatchLocale.resolve(pinned: pinned, phone: phone, scriptCapable: caps.expandCapability(WatchLocale.scriptCapability))
        let request = LocaleConfig.SetLanguageSetting.request(
            locale: Array(setting.tag.utf8), measurement: LocaleConfig.MeasurementSystem.metric, script: setting.script.map { Array($0.utf8) }
        )
        _ = try await session.request(request, timeoutMs: timeoutMs, label: "LanguageSetting")
        let scriptNote = setting.script.map { " script \($0)" } ?? ""
        log(LogEntry(.info, "LanguageSetting: \(setting.tag)\(scriptNote), metric (\(pinned.map { "app language \($0)" } ?? "phone language"))"))
        return true
    }
}
