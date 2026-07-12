import SwiftUI

/// 统一空态：SF Symbol 图标置于极光靛柔和圆形徽章内 + 主文案 + 可选副文案。
/// 对齐 Android EmptyState 与 Web cl-empty-icon，提升列表/结果为空时的观感。
struct VxinEmptyState: View {
    let systemImage: String
    let title: String
    var subtitle: String? = nil

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [Color.vxinBrand.opacity(0.16), Color.vxinBrand.opacity(0.06)],
                            center: .center, startRadius: 2, endRadius: 44
                        )
                    )
                    .frame(width: 80, height: 80)
                Image(systemName: systemImage)
                    .font(.system(size: 32))
                    .foregroundColor(.vxinBrand)
            }
            Text(title)
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(.primary)
            if let subtitle {
                Text(subtitle)
                    .font(.footnote)
                    .foregroundColor(.vxinTextSecondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(32)
    }
}
