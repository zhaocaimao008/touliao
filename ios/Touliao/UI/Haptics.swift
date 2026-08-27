import UIKit

/// 轻量触感反馈封装（UIKit generator，iOS 16 可用，无需权限）。
/// 只在高频/关键交互上用，避免滥用反而廉价。均在主线程调用（SwiftUI action 即主线程）。
enum Haptics {
    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }
    static func selection() {
        UISelectionFeedbackGenerator().selectionChanged()
    }
    static func notify(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        UINotificationFeedbackGenerator().notificationOccurred(type)
    }
}
