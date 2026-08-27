import UIKit

/// App 内截图：截取当前 App 的可见窗口（不含其它 App，iOS 平台限制所致），
/// 直接返回 UIImage，供聊天「截屏」一键发送——不经系统相册。
enum ScreenshotHelper {
    /// 截取当前前台 window 的可见内容。
    /// 用 UIGraphicsImageRenderer + drawHierarchy(afterScreenUpdates:) 抓真实渲染像素，
    /// 比 layer.render(in:) 更完整（能截到模糊/SwiftUI 合成层）。
    @MainActor
    static func captureKeyWindow() -> UIImage? {
        guard let window = activeKeyWindow() else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = window.screen.scale
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(bounds: window.bounds, format: format)
        return renderer.image { _ in
            // afterScreenUpdates:true 确保最新一帧（含刚弹出的面板收起后的界面）被截到
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
    }

    /// 找到当前活跃场景的 keyWindow（兼容多场景 / iPad 分屏）。
    @MainActor
    private static func activeKeyWindow() -> UIWindow? {
        let scenes = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
        // 优先前台活跃场景的 keyWindow
        if let key = scenes.first(where: { $0.activationState == .foregroundActive })?
            .windows.first(where: { $0.isKeyWindow }) {
            return key
        }
        // 兜底：任意场景的 keyWindow / 第一个 window
        return scenes.flatMap { $0.windows }.first(where: { $0.isKeyWindow })
            ?? scenes.flatMap { $0.windows }.first
    }
}
