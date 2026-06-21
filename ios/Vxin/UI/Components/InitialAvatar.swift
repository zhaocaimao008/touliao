import SwiftUI

/// 文字首字母头像（无头像占位，对齐 Android InitialAvatar），避免引入图片库
struct InitialAvatar: View {
    let name: String
    var size: CGFloat = 48

    private static let palette: [Color] = [
        Color(red: 0x1A/255, green: 0xBC/255, blue: 0x9C/255),
        Color(red: 0x34/255, green: 0x98/255, blue: 0xDB/255),
        Color(red: 0x9B/255, green: 0x59/255, blue: 0xB6/255),
        Color(red: 0xE6/255, green: 0x7E/255, blue: 0x22/255),
        Color(red: 0xE7/255, green: 0x4C/255, blue: 0x3C/255),
        .vxinGreen,
    ]

    private var letter: String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard let first = trimmed.first else { return "?" }
        return String(first).uppercased()
    }

    private var color: Color {
        Self.palette[abs(name.hashValue) % Self.palette.count]
    }

    var body: some View {
        RoundedRectangle(cornerRadius: size / 6)
            .fill(color)
            .frame(width: size, height: size)
            .overlay(
                Text(letter)
                    .foregroundColor(.white)
                    .font(.system(size: size * 0.42, weight: .semibold))
            )
    }
}
