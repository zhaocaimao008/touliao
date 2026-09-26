import SwiftUI

/// v4 玻璃材质（四端统一的悬浮胶囊：输入栏、浮层等）。
/// - Xcode 26（Swift 6.2）编译且运行在 iOS 26+：系统 Liquid Glass（`glassEffect`）。
/// - 更早的编译器或系统：`ultraThinMaterial` + 细描边 + 柔和阴影，外观接近。
/// PR 检查用 Xcode 16 编译，走 `#else` 分支；TestFlight 用 Xcode 26 编译，两条分支都会编进包。
struct TouliaoGlass: ViewModifier {
    var cornerRadius: CGFloat

    func body(content: Content) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            content.glassEffect(.regular, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        } else {
            fallback(content)
        }
        #else
        fallback(content)
        #endif
    }

    private func fallback(_ content: Content) -> some View {
        content
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.08), radius: 16, x: 0, y: 6)
    }
}

extension View {
    /// 悬浮玻璃胶囊。默认 26pt 圆角（与 Web/Android 输入栏一致）。
    func touliaoGlass(cornerRadius: CGFloat = 26) -> some View {
        modifier(TouliaoGlass(cornerRadius: cornerRadius))
    }
}
