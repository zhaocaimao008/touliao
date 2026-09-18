import SwiftUI

/// Public name retained; flat primary surface with a scalable minimum touch target.
struct VxinGradientButton: View {
    let title: String
    var loading: Bool = false
    var enabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text(title).touliaoFont(16, weight: .semibold).opacity(loading ? 0 : 1)
                if loading { ProgressView().tint(.vxinOnPrimary) }
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 48)
            .foregroundColor(enabled ? .vxinOnPrimary : .vxinTextSecondary)
            .background(enabled ? Color.vxinBrand : Color.vxinSurfaceSecondary)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .disabled(!enabled || loading)
        .accessibilityLabel(title)
    }
}
