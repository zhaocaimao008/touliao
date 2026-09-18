import SwiftUI

/// 统一空态：线性 图标置于主题柔和圆形徽章内 + 主文案 + 可选副文案。
/// 对齐 Android EmptyState 与 Web cl-empty-icon，提升列表/结果为空时的观感。
struct VxinEmptyState: View {
    let systemImage: String
    let title: String
    var subtitle: String? = nil

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle().fill(Color.vxinPrimarySoft).frame(width: 80, height: 80)
                TouliaoIcon(systemName: systemImage, size: 32)
                    .foregroundColor(.vxinBrand)
            }
            Text(title)
                .touliaoFont(VxinFontSize.md, weight: .medium)
                .foregroundColor(.vxinText)
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
