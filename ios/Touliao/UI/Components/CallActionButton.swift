import SwiftUI

/// The media canvas is always dark; control colors stay readable in either app theme.
struct CallActionButton: View {
    let label: String
    let color: Color
    let action: () -> Void
    private var symbol: String {
        if label == "接听" { return "phone.fill" }
        if label == "拒绝" || label == "挂断" { return "phone.down.fill" }
        if label == "回复" { return "text.bubble" }
        if label.contains("静音") { return "mic.fill" }
        if label == "翻转" { return "arrow.triangle.2.circlepath" }
        if label.contains("视频") || label.contains("摄像头") { return "video.fill" }
        if label == "切语音" { return "phone.fill" }
        return "speaker.wave.2.fill"
    }
    private var slashed: Bool { label == "取消静音" || label == "开摄像头" }
    var body: some View {
        VStack(spacing: 8) {
            Button(action: action) {
                TouliaoIcon(systemName: symbol, size: 24)
                    .overlay {
                        if slashed {
                            Path { p in p.move(to: CGPoint(x: 2, y: 2)); p.addLine(to: CGPoint(x: 22, y: 22)) }
                                .stroke(Color.white, lineWidth: 1.8)
                        }
                    }
                    .foregroundColor(.white)
                    .frame(width: 64, height: 64)
                    .background(color).clipShape(Circle())
            }
            .accessibilityLabel(label)
            Text(label).touliaoFont(12).foregroundColor(.white.opacity(0.86))
                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, alignment: .top)
    }
}
