// Generated from ui-kit/tokens.json by scripts/generate-component-tokens.py. Do not edit.
import SwiftUI

enum TouliaoMetrics {
    static let space0: CGFloat = 0
    static let space1: CGFloat = 4
    static let space2: CGFloat = 8
    static let space3: CGFloat = 12
    static let space4: CGFloat = 16
    static let space5: CGFloat = 20
    static let space6: CGFloat = 24
    static let space8: CGFloat = 32
    static let space10: CGFloat = 40
    static let space12: CGFloat = 48
    static let radiusSmall: CGFloat = 8
    static let radiusControl: CGFloat = 12
    static let radiusCard: CGFloat = 12
    static let radiusBubble: CGFloat = 16
    static let radiusDialog: CGFloat = 20
    static let radiusPill: CGFloat = 999
    static let fontDisplay: CGFloat = 28
    static let leadingDisplay: CGFloat = 1.3
    static let fontTitle: CGFloat = 22
    static let leadingTitle: CGFloat = 1.3
    static let fontHeadline: CGFloat = 18
    static let leadingHeadline: CGFloat = 1.3
    static let fontBody: CGFloat = 16
    static let leadingBody: CGFloat = 1.6
    static let fontSecondary: CGFloat = 14
    static let leadingSecondary: CGFloat = 1.6
    static let fontCaption: CGFloat = 12
    static let leadingCaption: CGFloat = 1.4
    static let durationInstant: Double = 0.0
    static let durationFast: Double = 0.12
    static let durationNormal: Double = 0.18
    static let durationSlow: Double = 0.24
    static let avatarMetadata: CGFloat = 28
    static let avatarMessage: CGFloat = 36
    static let avatarList: CGFloat = 44
    static let avatarRequest: CGFloat = 48
    static let avatarProfile: CGFloat = 64
    static let avatarHero: CGFloat = 66
    static let avatarCall: CGFloat = 96
    static let layerBase: Int = 0
    static let layerRaised: Int = 1
    static let layerLocal: Int = 10
    static let layerPage: Int = 60
    static let layerSticky: Int = 100
    static let layerDropdown: Int = 200
    static let layerPanel: Int = 300
    static let layerModal: Int = 1000
    static let layerPopover: Int = 1100
    static let layerToast: Int = 1200
    static let layerTooltip: Int = 1300
    static let layerCall: Int = 2000
    static let layerCallTop: Int = 3000
    static let layerTop: Int = 9999
    static let layerNative: Int = 100000
    static let touchTarget: CGFloat = 44
    static let buttonHeight: CGFloat = 48
    static let fieldHeight: CGFloat = 48
    static let settingHeight: CGFloat = 57
    static let borderDefault: CGFloat = 1
    static let borderFocus: CGFloat = 2
    static let disabledOpacity: CGFloat = 0.55
    static let skeletonDuration: Double = 1.2
    static let toastDuration: Double = 4.0
    static let toastErrorDuration: Double = 4.5
    static let toastMaximumDuration: Double = 12.0
    static let toastReadPerCharacter: Double = 0.08
    static let callEndedDuration: Double = 1.8
    static let callControlSize: CGFloat = 64
    static let callPrimarySize: CGFloat = 68
}

enum TouliaoTextRole {
    case display, title, headline, body, secondary, caption
    var size: CGFloat {
        switch self {
        case .display: return TouliaoMetrics.fontDisplay
        case .title: return TouliaoMetrics.fontTitle
        case .headline: return TouliaoMetrics.fontHeadline
        case .body: return TouliaoMetrics.fontBody
        case .secondary: return TouliaoMetrics.fontSecondary
        case .caption: return TouliaoMetrics.fontCaption
        }
    }
    var style: Font.TextStyle {
        switch self {
        case .display: return .largeTitle
        case .title: return .title2
        case .headline: return .headline
        case .body: return .body
        case .secondary: return .subheadline
        case .caption: return .caption
        }
    }
    var leading: CGFloat {
        switch self {
        case .display: return TouliaoMetrics.leadingDisplay
        case .title: return TouliaoMetrics.leadingTitle
        case .headline: return TouliaoMetrics.leadingHeadline
        case .body: return TouliaoMetrics.leadingBody
        case .secondary: return TouliaoMetrics.leadingSecondary
        case .caption: return TouliaoMetrics.leadingCaption
        }
    }
    var weight: Font.Weight {
        switch self {
        case .display: return .semibold
        case .title: return .semibold
        case .headline: return .medium
        case .body: return .regular
        case .secondary: return .regular
        case .caption: return .regular
        }
    }
}

/// 通话 UI 专用调色板：有意为之的固定深色（通话界面始终深色画布，不跟随系统深浅模式）。
/// 若未来需要浅色通话 UI，再收敛到 TouliaoDesign adaptive token。
enum TouliaoMedia {
    static let canvas = Color(red: 16 / 255.0, green: 21 / 255.0, blue: 30 / 255.0)
    static let surface = Color(red: 24 / 255.0, green: 33 / 255.0, blue: 45 / 255.0)
    static let text = Color(red: 234 / 255.0, green: 240 / 255.0, blue: 248 / 255.0)
    static let secondary = Color(red: 196 / 255.0, green: 208 / 255.0, blue: 224 / 255.0)
    static let control = Color(red: 45 / 255.0, green: 58 / 255.0, blue: 76 / 255.0)
    static let selected = Color(red: 65 / 255.0, green: 107 / 255.0, blue: 180 / 255.0)
    static let danger = Color(red: 190 / 255.0, green: 63 / 255.0, blue: 78 / 255.0)
    static let accept = Color(red: 24 / 255.0, green: 133 / 255.0, blue: 107 / 255.0)
}

enum TouliaoMotion {
    static func standard(_ duration: Double = TouliaoMetrics.durationNormal) -> Animation { .timingCurve(0.2, 0, 0, 1, duration: duration) }
    static func entrance(_ duration: Double = TouliaoMetrics.durationNormal) -> Animation { .timingCurve(0, 0, 0.2, 1, duration: duration) }
    static func exit(_ duration: Double = TouliaoMetrics.durationNormal) -> Animation { .timingCurve(0.4, 0, 1, 1, duration: duration) }
}
