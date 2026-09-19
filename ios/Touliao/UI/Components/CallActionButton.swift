import SwiftUI

/// Label and callbacks remain owned by the call UI; only presentation is mapped here.
struct CallActionButton: View {
    let label: String
    let color: Color
    let action: () -> Void
    private var icon: String {
        if label == "接听" { return "acceptCall" }
        if label == "拒绝" { return "rejectCall" }
        if label == "挂断" { return "hangup" }
        if label.contains("回复") { return "message" }
        if label == "取消静音" { return "microphoneMuted" }
        if label.contains("静音") { return "microphone" }
        if label == "翻转" { return "cameraSwitch" }
        if label == "开摄像头" { return "cameraOff" }
        if label.contains("视频") || label.contains("摄像头") { return "video" }
        if label == "切语音" { return "phone" }
        if label.contains("蓝牙") { return "bluetooth" }
        if label.contains("听筒") { return "earpiece" }
        return "speaker"
    }
    var body: some View {
        VStack(spacing: 8) {
            Button(action: action) {
                TouliaoIcon(icon, size: .md)
                    .foregroundColor(IconColor.onDark)
                    .frame(width: 64, height: 64)
                    .background(color).clipShape(Circle())
            }
            .accessibilityLabel(label)
            Text(label).touliaoFont(12).foregroundColor(IconColor.onDark.opacity(0.86))
                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, alignment: .top)
    }
}
