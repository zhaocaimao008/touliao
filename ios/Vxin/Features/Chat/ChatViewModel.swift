import Foundation
import Combine
import UIKit

/// 上传中的占位项（成功后被真实 Message 替换），对齐 Android PendingUpload
struct PendingUpload: Identifiable {
    let id: String = UUID().uuidString
    let type: String                // image | voice | video | file
    let name: String
    let previewImage: UIImage?       // 图片本地预览
    var failed: Bool = false
}

@MainActor
final class ChatViewModel: ObservableObject {
    @Published var messages: [Message] = []
    @Published var pending: [PendingUpload] = []
    @Published var input = ""
    @Published var sending = false
    @Published var recording = false
    @Published var peerTyping = false
    @Published var peerReadAt: Double = 0      // 对方已读时间（秒）；我的消息 createdAt <= 此值即「已读」
    @Published var replyingTo: Message?        // 正在回复的消息
    @Published var error: String?

    let conversationId: String
    let title: String
    let myId: String

    private let repo = ChatRepository.shared
    private let recorder = AudioRecorder.shared
    private let player = AudioPlayerService.shared
    private var cancellables = Set<AnyCancellable>()
    private var lastTypingEmit = Date.distantPast
    private var typingClearTask: Task<Void, Never>?

    init(conversationId: String, title: String, myId: String) {
        self.conversationId = conversationId
        self.title = title
        self.myId = myId

        repo.incomingPublisher
            .sink { [weak self] msg in Task { @MainActor in self?.onIncoming(msg) } }
            .store(in: &cancellables)

        repo.typingPublisher
            .sink { [weak self] e in Task { @MainActor in self?.onTyping(e) } }
            .store(in: &cancellables)

        repo.readPublisher
            .sink { [weak self] e in Task { @MainActor in self?.onRead(e) } }
            .store(in: &cancellables)

        repo.messageDeletedPublisher
            .sink { [weak self] msgId in Task { @MainActor in self?.messages.removeAll { $0.id == msgId } } }
            .store(in: &cancellables)

        repo.reactionPublisher
            .sink { [weak self] (msgId, reactions) in Task { @MainActor in self?.applyReactions(msgId, reactions) } }
            .store(in: &cancellables)

        repo.joinConversation(conversationId)
        Task { await loadHistory() }
    }

    // MARK: - 消息操作:回复/撤回/表情回应
    func startReply(_ msg: Message) { replyingTo = msg }
    func cancelReply() { replyingTo = nil }

    func recall(_ msg: Message) {
        Task { await repo.deleteMessage(msg.id) }   // 实时事件移除
    }

    func react(_ msg: Message, emoji: String) {
        Task {
            let reactions = await repo.react(msg.id, emoji: emoji)
            applyReactions(msg.id, reactions)
        }
    }

    private func applyReactions(_ msgId: String, _ reactions: [MessageReaction]) {
        if let idx = messages.firstIndex(where: { $0.id == msgId }) {
            messages[idx].reactions = reactions
        }
    }

    func resolveMediaUrl(_ url: String?) -> String? { MediaUrlResolver.resolve(url) }

    // MARK: - 历史 / 实时
    func loadHistory() async {
        do {
            messages = try await repo.loadHistory(conversationId)
            markReadLatest()   // 打开会话即标记已读
        } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "加载消息失败" }
    }

    private func onIncoming(_ msg: Message) {
        guard msg.conversationId == conversationId else { return }
        appendUnique(msg)
        if msg.senderId != myId { markReadLatest() }   // 在会话内收到对方消息即已读
    }

    private func onTyping(_ e: TypingEvent) {
        guard e.conversationId == conversationId, e.userId != myId else { return }
        peerTyping = e.isTyping
        typingClearTask?.cancel()
        if e.isTyping {
            typingClearTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 5_000_000_000)   // 5s 兜底隐藏
                await MainActor.run { self?.peerTyping = false }
            }
        }
    }

    private func onRead(_ e: ReadEvent) {
        guard e.conversationId == conversationId, e.userId != myId else { return }
        if e.readAt > peerReadAt { peerReadAt = e.readAt }
    }

    /// 我的消息是否已被对方读过（双勾）
    func isReadByPeer(_ msg: Message) -> Bool {
        msg.senderId == myId && peerReadAt > 0 && msg.createdAt <= peerReadAt
    }

    func markReadLatest() {
        guard let last = messages.last else { return }
        Task { await repo.markRead(conversationId: conversationId, messageId: last.id) }
    }

    /// 输入变化时节流发送 typing
    func userIsTyping() {
        guard !input.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        if Date().timeIntervalSince(lastTypingEmit) > 2 {
            lastTypingEmit = Date()
            repo.emitTyping(conversationId)
        }
    }

    /// 退出聊天：发送 read + stop_typing
    func onLeave() {
        repo.emitStopTyping(conversationId)
        markReadLatest()
    }

    // MARK: - 文本
    func sendText() {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !sending else { return }
        let replyId = replyingTo?.id
        input = ""
        replyingTo = nil
        sending = true
        error = nil
        repo.emitStopTyping(conversationId)
        Task {
            let result = await repo.sendText(conversationId: conversationId, content: text, replyToId: replyId)
            sending = false
            switch result {
            case .success(let msg): appendUnique(msg)
            case .failure(let err):
                input = text
                error = (err as? LocalizedError)?.errorDescription ?? "发送失败"
            }
        }
    }

    // MARK: - 媒体上传
    func upload(data: Data, fileName: String, mimeType: String, localType: String, preview: UIImage?) {
        let item = PendingUpload(type: localType, name: fileName, previewImage: preview)
        pending.append(item)
        Task {
            do {
                let msg = try await repo.uploadMedia(conversationId: conversationId, data: data, fileName: fileName, mimeType: mimeType)
                removePending(item.id)
                appendUnique(msg)
            } catch {
                markFailed(item.id)
                self.error = (error as? LocalizedError)?.errorDescription ?? "上传失败"
            }
        }
    }

    // MARK: - 录音
    func startRecording() {
        guard !recording else { return }
        if recorder.start() { recording = true } else { error = "无法开始录音" }
    }

    func stopRecordingAndSend() {
        guard recording else { return }
        recording = false
        guard let url = recorder.stop() else { error = "录音失败"; return }
        Task {
            guard let data = try? Data(contentsOf: url) else { error = "读取录音失败"; return }
            upload(data: data, fileName: url.lastPathComponent, mimeType: recorder.mimeType, localType: "voice", preview: nil)
        }
    }

    func cancelRecording() {
        recorder.cancel()
        recording = false
    }

    // MARK: - 播放 / 移除失败项
    func playVoice(_ message: Message) {
        if let url = resolveMediaUrl(message.fileUrl) { player.play(urlString: url) }
    }

    func dismissFailed(_ id: String) {
        pending.removeAll { $0.id == id }
    }

    // MARK: - helpers
    private func appendUnique(_ msg: Message) {
        guard !messages.contains(where: { $0.id == msg.id }) else { return }
        messages.append(msg)
    }

    private func removePending(_ id: String) { pending.removeAll { $0.id == id } }

    private func markFailed(_ id: String) {
        if let idx = pending.firstIndex(where: { $0.id == id }) { pending[idx].failed = true }
    }
}
