import SwiftUI

/// Public name retained; flat primary surface with a scalable minimum touch target.
enum TouliaoButtonVariant { case primary, secondary, ghost, text, danger }

struct TouliaoButton: View {
    let title: String
    var loading: Bool = false
    var enabled: Bool = true
    var variant: TouliaoButtonVariant = .primary
    let action: () -> Void

    private var foreground: Color {
        switch variant {
        case .primary: return .vxinOnPrimary
        case .danger: return .vxinError
        case .secondary: return .vxinText
        case .ghost, .text: return .vxinBrand
        }
    }
    private var surface: Color {
        switch variant {
        case .primary: return .vxinBrand
        case .secondary: return .vxinSurfaceSecondary
        case .danger: return TouliaoDesign.dangerSoft
        case .ghost, .text: return .clear
        }
    }
    var body: some View {
        Button(action: action) {
            ZStack {
                Text(title).touliaoText(.body, weight: .semibold).opacity(loading ? 0 : 1)
                if loading { ProgressView().tint(foreground) }
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: TouliaoMetrics.buttonHeight)
            .foregroundColor((enabled || loading) ? foreground : .vxinTextSecondary)
            .background((enabled || loading) ? surface : Color.vxinSurfaceSecondary)
            .clipShape(RoundedRectangle(cornerRadius: TouliaoMetrics.radiusControl, style: .continuous))
        }
        .disabled(!enabled || loading)
        .accessibilityLabel(title)
    }
}

// Compatibility alias: existing call sites use the same implementation.
typealias VxinGradientButton = TouliaoButton
