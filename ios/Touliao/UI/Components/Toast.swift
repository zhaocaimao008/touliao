import SwiftUI
import UIKit

enum TouliaoFeedbackKind { case neutral, success, error, warning }

func touliaoFeedbackDuration(_ text: String, kind: TouliaoFeedbackKind) -> Double {
    let base = kind == .error ? TouliaoMetrics.toastErrorDuration : TouliaoMetrics.toastDuration
    let reading = Double(text.count) * TouliaoMetrics.toastReadPerCharacter
    let accessible = UIAccessibility.isVoiceOverRunning ? TouliaoMetrics.toastMaximumDuration : base
    return min(TouliaoMetrics.toastMaximumDuration, max(accessible, reading))
}


/// 轻量一次性提示（toast）。绑定到 ViewModel 的 `@Published var error: String?`，
/// 非空时在底部浮现一条中性提示，按共享阅读时长自动清空（把绑定置 nil）。
///
/// 说明：项目里多数 ViewModel 复用同一个 `error` 字段承载「错误」与「已收藏/已转发」等
/// 成功文案，颜色难以区分，这里统一用中性深色气泡，不做红/绿区分，避免过度设计。
/// 已用 `if let error = vm.error {...}` 内联展示的页面(GroupInfo/CreateGroup/MomentCompose 等)
/// 不套此 modifier，保持原样。
private struct ToastModifier: ViewModifier {
    @Binding var message: String?
    var kind: TouliaoFeedbackKind = .neutral
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .bottom) {
            if let message, !message.isEmpty {
                TouliaoToast(message: message, kind: kind)
                    .padding(.bottom, 12)
                    .padding(.horizontal, 24)
                    .transition(reduceMotion ? .identity : .move(edge: .bottom).combined(with: .opacity))
                    .task(id: message) {
                        // VoiceOver 朗读 toast 内容
                        UIAccessibility.post(notification: .announcement, argument: message)
                        // 展示后自动清空；被新消息覆盖时 task 会随 id 变化重启
                        do { try await Task.sleep(nanoseconds: UInt64(touliaoFeedbackDuration(message, kind: kind) * 1_000_000_000)) }
                        catch { return }
                        guard self.message == message else { return }
                        self.message = nil
                    }
            }
        }
        .animation(reduceMotion ? nil : TouliaoMotion.standard(), value: message)
    }
}

/// Typed feedback; legacy mixed success/error String bindings explicitly stay neutral.
struct TouliaoToast: View {
    let message: String
    var kind: TouliaoFeedbackKind = .neutral

    var body: some View {
        Text(message)
            .touliaoText(.secondary)
            .foregroundColor(kind == .error ? .vxinError : kind == .success ? .vxinSuccess : .vxinText)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(Color.vxinSurface)
            .clipShape(RoundedRectangle(cornerRadius: VxinRadius.md))
            .overlay(RoundedRectangle(cornerRadius: VxinRadius.md).stroke(Color.vxinBorder, lineWidth: 1))
            .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
            .accessibilityIdentifier("touliao-toast")
            .allowsHitTesting(false)
    }
}

extension View {
    /// 绑定 `@Published var error: String?`，非空时浮现一次性中性提示并自动清空。
    func toast(_ message: Binding<String?>, kind: TouliaoFeedbackKind = .neutral) -> some View {
        modifier(ToastModifier(message: message, kind: kind))
    }
}
