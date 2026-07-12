import SwiftUI

/// v信 主按钮：极光靛渐变实心药丸 + 加载态（对齐 Web / Android VxinGradientButton）。
/// 统一各处 CTA 视觉。
struct VxinGradientButton: View {
    let title: String
    var loading: Bool = false
    var enabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                if loading { ProgressView().tint(.white) }
                else { Text(title).bold() }
            }
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(
                Group {
                    if enabled {
                        LinearGradient(colors: [.vxinBrandLight, .vxinBrandDark],
                                       startPoint: .leading, endPoint: .trailing)
                    } else {
                        Color.vxinTextSecondary.opacity(0.4)
                    }
                }
            )
            .foregroundColor(.white)
            .clipShape(RoundedRectangle(cornerRadius: 25, style: .continuous))
            .shadow(color: enabled ? .vxinBrand.opacity(0.35) : .clear, radius: 8, y: 4)
        }
        .disabled(!enabled || loading)
    }
}
