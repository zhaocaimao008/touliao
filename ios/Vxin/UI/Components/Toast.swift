import SwiftUI

/// 轻量一次性提示（toast）。绑定到 ViewModel 的 `@Published var error: String?`，
/// 非空时在底部浮现一条中性提示，数秒后自动清空（把绑定置 nil）。
///
/// 说明：项目里多数 ViewModel 复用同一个 `error` 字段承载「错误」与「已收藏/已转发」等
/// 成功文案，颜色难以区分，这里统一用中性深色气泡，不做红/绿区分，避免过度设计。
/// 已用 `if let error = vm.error {...}` 内联展示的页面(GroupInfo/CreateGroup/MomentCompose 等)
/// 不套此 modifier，保持原样。
private struct ToastModifier: ViewModifier {
    @Binding var message: String?
    var seconds: Double = 2.4

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let message, !message.isEmpty {
                Text(message)
                    .font(.subheadline)
                    .foregroundColor(.white)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Color(white: 0.15).opacity(0.92))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .padding(.bottom, 40)
                    .padding(.horizontal, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task(id: message) {
                        // 展示后自动清空；被新消息覆盖时 task 会随 id 变化重启
                        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                        self.message = nil
                    }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: message)
    }
}

extension View {
    /// 绑定 `@Published var error: String?`，非空时浮现一次性中性提示并自动清空。
    func toast(_ message: Binding<String?>) -> some View {
        modifier(ToastModifier(message: message))
    }
}
