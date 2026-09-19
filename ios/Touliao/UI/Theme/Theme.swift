import SwiftUI
import UIKit

// Compatibility names retain all existing call sites and business behavior.
extension Color {
    static let vxinBrand = TouliaoDesign.primary
    static let vxinBrandLight = TouliaoDesign.primary
    static let vxinBrandDark = TouliaoDesign.primaryActive
    static let vxinTeal = TouliaoDesign.primary
    static let vxinGreen = TouliaoDesign.primary
    static let vxinBubbleMine = TouliaoDesign.messageOutgoing
    static let vxinBubbleText = TouliaoDesign.messageOutgoingText
    static let vxinTextSecondary = TouliaoDesign.readableMuted
    static let vxinText = TouliaoDesign.text
    static let vxinError = TouliaoDesign.readableDanger
    static let vxinSuccess = TouliaoDesign.success
    static let vxinOnline = TouliaoDesign.success
    static let vxinInfoBannerFg = TouliaoDesign.primary
    static let vxinCard = TouliaoDesign.surface
    static let vxinBackground = TouliaoDesign.background
    static let vxinSurface = TouliaoDesign.surface
    static let vxinSurfaceSecondary = TouliaoDesign.surfaceSecondary
    static let vxinPrimarySoft = TouliaoDesign.primarySoft
    static let vxinOnPrimary = TouliaoDesign.primaryForeground
    static let vxinBorder = TouliaoDesign.border
    // Existing financial cards retain their semantic color and functionality.
    static let vxinCallAccept = Color(red: 24 / 255, green: 133 / 255, blue: 107 / 255)
    static let vxinCallDanger = Color(red: 190 / 255, green: 63 / 255, blue: 78 / 255)
    static let vxinPay = Color(red: 0x07 / 255, green: 0xC1 / 255, blue: 0x60 / 255)
    static let vxinPayGradStart = Color(red: 0x09 / 255, green: 0xBB / 255, blue: 0x07 / 255)
    static let vxinPayGradEnd = vxinPay
}
extension LinearGradient {
    static let vxinBubble = LinearGradient(colors: [.vxinBubbleMine, .vxinBubbleMine],
                                           startPoint: .top, endPoint: .bottom)
    static let vxinCallAccept = Color(red: 24 / 255, green: 133 / 255, blue: 107 / 255)
    static let vxinCallDanger = Color(red: 190 / 255, green: 63 / 255, blue: 78 / 255)
    static let vxinPay = LinearGradient(colors: [.vxinPayGradStart, .vxinPayGradEnd],
                                        startPoint: .topLeading, endPoint: .bottomTrailing)
}

/// System SF/PingFang fonts with the design's sizes and Dynamic Type scaling.
private struct TouliaoFontModifier: ViewModifier {
    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 16
    let weight: Font.Weight
    let design: Font.Design
    let lineSpacingRatio: CGFloat
    init(size: CGFloat, weight: Font.Weight, design: Font.Design) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: .body)
        self.weight = weight; self.design = design
        self.lineSpacingRatio = size <= 16 ? 0.4 : 0.1
    }
    func body(content: Content) -> some View {
        content.font(.system(size: size, weight: weight, design: design))
            .lineSpacing(size * lineSpacingRatio)
    }
}
private struct TouliaoTextModifier: ViewModifier {
    @ScaledMetric private var size: CGFloat
    let role: TouliaoTextRole
    let weight: Font.Weight
    let design: Font.Design
    init(role: TouliaoTextRole, weight: Font.Weight?, design: Font.Design) {
        self.role = role; self.weight = weight ?? role.weight; self.design = design
        _size = ScaledMetric(wrappedValue: role.size, relativeTo: role.style)
    }
    func body(content: Content) -> some View {
        content.font(.system(size: size, weight: weight, design: design))
            .lineSpacing(max(0, size * role.leading - UIFont.systemFont(ofSize: size).lineHeight))
    }
}
extension View {
    func touliaoText(_ role: TouliaoTextRole, weight: Font.Weight? = nil,
                     design: Font.Design = .default) -> some View {
        modifier(TouliaoTextModifier(role: role, weight: weight, design: design))
    }
    // Compatibility for genuinely local optical sizes; standard text uses roles.
    func touliaoFont(_ size: CGFloat, weight: Font.Weight = .regular,
                    design: Font.Design = .default) -> some View {
        modifier(TouliaoFontModifier(size: size, weight: weight, design: design))
    }
    func touliaoPage() -> some View {
        self.frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.vxinBackground)
            .scrollContentBackground(.hidden)
            .environment(\.defaultMinListRowHeight, 48)
            .touliaoText(.body)
            .foregroundColor(.vxinText)
            .tint(.vxinBrand)
            .toolbarBackground(Color.vxinSurface, for: .navigationBar, .tabBar)
            .toolbarBackground(.visible, for: .navigationBar, .tabBar)
    }
}

struct TouliaoTextFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .touliaoText(.body)
            .padding(.horizontal, 12).padding(.vertical, 12)
            .frame(minHeight: TouliaoMetrics.fieldHeight)
            .background(Color.vxinSurface)
            .clipShape(RoundedRectangle(cornerRadius: TouliaoMetrics.radiusControl))
            .overlay(RoundedRectangle(cornerRadius: TouliaoMetrics.radiusControl).stroke(Color.vxinBorder, lineWidth: TouliaoMetrics.borderDefault))
    }
}

/// Honor the in-app smaller preset at the standard OS size, never lower larger OS text.
func touliaoTextSize(system: DynamicTypeSize, preference: DynamicTypeSize) -> DynamicTypeSize {
    system > .large ? max(system, preference) : preference
}
