import SwiftUI

/// 文字首字母头像（无头像占位，对齐 Android InitialAvatar），避免引入图片库
struct InitialAvatar: View {
    let name: String
    var size: CGFloat = TouliaoMetrics.avatarList

    private var letter: String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard let first = trimmed.first else { return "?" }
        return String(first).uppercased()
    }

    var body: some View {
        RoundedRectangle(cornerRadius: TouliaoMetrics.radiusControl)
            .fill(Color.vxinPrimarySoft)
            .frame(width: size, height: size)
            .overlay(
                Text(letter)
                    .foregroundColor(.vxinBrand)
                    .font(.system(size: size * 0.42, weight: .semibold))
            )
    }
}
