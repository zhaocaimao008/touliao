import SwiftUI

/// 统一空态：线性 图标置于主题柔和圆形徽章内 + 主文案 + 可选副文案。
/// 对齐 Android EmptyState 与 Web cl-empty-icon，提升列表/结果为空时的观感。
struct VxinEmptyState: View {
    let icon: String
    let title: String
    var subtitle: String? = nil
    var isError = false
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: TouliaoMetrics.space3) {
            ZStack {
                Circle().fill(Color.vxinPrimarySoft).frame(width: 80, height: 80)
                TouliaoIcon(icon, size: .lg)
                    .foregroundColor(isError ? .vxinError : .vxinBrand)
            }
            Text(title)
                .touliaoText(.body, weight: .medium)
                .foregroundColor(isError ? .vxinError : .vxinText)
            if let subtitle {
                Text(subtitle)
                    .touliaoText(.secondary)
                    .foregroundColor(.vxinTextSecondary)
                    .multilineTextAlignment(.center)
            }
            if let actionTitle, let action {
                TouliaoButton(title: actionTitle, variant: .secondary, action: action)
            }
        }
        .accessibilityElement(children: .contain)
        .frame(maxWidth: .infinity)
        .padding(TouliaoMetrics.space8)
    }
}
