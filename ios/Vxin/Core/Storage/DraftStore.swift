import Foundation

/// 会话输入草稿（对齐微信/Web/Android：切走会话再回来，未发送的文字仍在；
/// 会话列表显示「[草稿]」前缀）。按 conversationId 持久化到 UserDefaults。
final class DraftStore {
    static let shared = DraftStore()
    private init() {}

    private let prefix = "vxin_draft_"

    /// 读取草稿；无则返回空串
    func get(_ conversationId: String) -> String {
        guard !conversationId.isEmpty else { return "" }
        return UserDefaults.standard.string(forKey: prefix + conversationId) ?? ""
    }

    /// 写入草稿：空则清除（避免残留空键）
    func set(_ conversationId: String, _ text: String) {
        guard !conversationId.isEmpty else { return }
        let key = prefix + conversationId
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            UserDefaults.standard.removeObject(forKey: key)
        } else {
            UserDefaults.standard.set(text, forKey: key)
        }
    }

    func clear(_ conversationId: String) { set(conversationId, "") }
}
