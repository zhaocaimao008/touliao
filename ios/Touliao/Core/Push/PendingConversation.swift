import Foundation
import Combine

/// 冷启动点击推送通知时的「待打开会话」缓存。
///
/// 背景：App 冷启动时用户点击通知，SessionStore.restoreSession() 异步恢复中，
/// RootView 停在 .loading、ConversationListView 尚未挂载 → NotificationCenter 广播丢失。
/// 解决：AppDelegate 收到通知点击时先写进这里，ConversationListView 挂载/出现时
/// 检查并消费（take），未消费的会话 id 一直保留到被打开。
final class PendingConversation {
    static let shared = PendingConversation()
    private init() {}

    private let lock = NSLock()
    private var pending: String?

    /// 写入待打开会话（幂等，新值覆盖旧值——用户只关心最后点的那个）。
    func set(_ conversationId: String) {
        lock.lock(); defer { lock.unlock() }
        guard !conversationId.isEmpty else { return }
        pending = conversationId
    }

    /// 取出并清除待打开会话。返回 nil 表示没有待处理项。
    /// 调用方应在 UI 挂载/导航栈可用时调用（如 ConversationListView.onAppear）。
    func take() -> String? {
        lock.lock(); defer { lock.unlock() }
        let v = pending
        pending = nil
        return v
    }
}
