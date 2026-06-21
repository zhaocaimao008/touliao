import SwiftUI
import UIKit
import PhotosUI
import UniformTypeIdentifiers
import Kingfisher

struct ChatView: View {
    @StateObject private var vm: ChatViewModel
    @State private var photoItem: PhotosPickerItem?
    @State private var showFileImporter = false
    @State private var showStickerPanel = false
    private let isGroup: Bool
    private let onOpenGroupInfo: () -> Void

    init(conversation: Conversation, myId: String, onOpenGroupInfo: @escaping () -> Void = {}) {
        self.isGroup = conversation.type == "group"
        self.onOpenGroupInfo = onOpenGroupInfo
        _vm = StateObject(wrappedValue: ChatViewModel(
            conversationId: conversation.id,
            title: conversation.name,
            myId: myId
        ))
    }

    var body: some View {
        VStack(spacing: 0) {
            messageList
            inputBar
        }
        .navigationTitle(vm.peerTyping ? "对方正在输入…" : (vm.title.isEmpty ? "聊天" : vm.title))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if isGroup {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: onOpenGroupInfo) { Image(systemName: "ellipsis") }
                }
            }
        }
        .onChange(of: vm.input) { _ in vm.userIsTyping() }
        .onDisappear { vm.onLeave() }
        .onChange(of: photoItem) { item in handlePhoto(item) }
        .fileImporter(isPresented: $showFileImporter, allowedContentTypes: [.item], allowsMultipleSelection: false) { result in
            handleFile(result)
        }
    }

    // MARK: - 消息列表
    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(vm.messages) { msg in
                        MessageBubble(msg: msg, isMine: msg.senderId == vm.myId, vm: vm)
                            .id(msg.id)
                    }
                    ForEach(vm.pending) { p in
                        PendingBubbleView(pending: p) { vm.dismissFailed(p.id) }
                            .id(p.id)
                    }
                    Color.clear.frame(height: 1).id(bottomAnchor)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .onChange(of: vm.messages.count) { _ in withAnimation { proxy.scrollTo(bottomAnchor, anchor: .bottom) } }
            .onChange(of: vm.pending.count) { _ in withAnimation { proxy.scrollTo(bottomAnchor, anchor: .bottom) } }
        }
    }

    private let bottomAnchor = "BOTTOM_ANCHOR"

    // MARK: - 输入栏
    private var inputBar: some View {
        VStack(spacing: 0) {
            if let r = vm.replyingTo {
                HStack {
                    Text("回复 \(r.senderName): \(replyPreviewText(r))")
                        .font(.caption).foregroundColor(.vxinTextSecondary).lineLimit(1)
                    Spacer()
                    Button { vm.cancelReply() } label: { Image(systemName: "xmark.circle.fill").foregroundColor(.vxinTextSecondary) }
                }
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(Color.gray.opacity(0.12))
            }
            if vm.recording {
                Text("● 录音中…点击麦克风停止并发送")
                    .font(.footnote)
                    .foregroundColor(.vxinError)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16).padding(.vertical, 4)
            }
            HStack(spacing: 6) {
                Button { showStickerPanel.toggle(); if showStickerPanel { vm.loadStickers() } } label: { Text("😀").font(.title3) }
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Text("🖼").font(.title3)
                }
                Button { showFileImporter = true } label: { Text("📎").font(.title3) }
                Button { onMicTap() } label: { Text(vm.recording ? "⏹" : "🎤").font(.title3) }

                TextField("输入消息…", text: $vm.input, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)

                Button { vm.sendText() } label: {
                    if vm.sending { ProgressView() }
                    else { Image(systemName: "paperplane.fill").foregroundColor(vm.input.isEmpty ? .vxinTextSecondary : .vxinGreen) }
                }
                .disabled(vm.input.isEmpty || vm.sending)
            }
            .padding(8)

            if showStickerPanel {
                stickerEmojiPanel
            }
        }
    }

    private let emojis = ["😀","😁","😂","🤣","😊","😍","😘","😎","🤔","😅","😉","😴","😭","😡","🥺","👍","👎","🙏","👏","💪","🎉","❤️","💔","🔥","⭐","✅","❌","🌹","🍺","☕","🤝","👌"]

    private var stickerEmojiPanel: some View {
        VStack(alignment: .leading, spacing: 4) {
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHGrid(rows: [GridItem(.fixed(34)), GridItem(.fixed(34))], spacing: 6) {
                    ForEach(emojis, id: \.self) { e in
                        Text(e).font(.title3).onTapGesture { vm.appendEmoji(e) }
                    }
                }
                .padding(.horizontal, 8)
            }
            if !vm.stickers.isEmpty {
                Divider()
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(vm.stickers) { s in
                            KFImage(URL(string: vm.resolveMediaUrl(s.url) ?? ""))
                                .resizable().scaledToFit().frame(width: 60, height: 60)
                                .onTapGesture { vm.sendSticker(s); showStickerPanel = false }
                        }
                    }
                    .padding(.horizontal, 8)
                }
            } else {
                Text("还没有表情，长按聊天图片可「收藏表情」").font(.caption2).foregroundColor(.vxinTextSecondary).padding(8)
            }
        }
        .frame(height: 150)
        .background(Color(.secondarySystemBackground))
    }

    // MARK: - 交互
    private func replyPreviewText(_ msg: Message) -> String {
        switch msg.type {
        case "image": return "[图片]"; case "voice": return "[语音]"
        case "video": return "[视频]"; case "file": return "[文件]"
        default: return msg.content
        }
    }

    private func onMicTap() {
        if vm.recording { vm.stopRecordingAndSend() }
        else { Task { if await AudioRecorder.shared.requestPermission() { vm.startRecording() } } }
    }

    private func handlePhoto(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            defer { photoItem = nil }
            guard let data = try? await item.loadTransferable(type: Data.self) else { return }
            let image = UIImage(data: data)
            let jpeg = image?.jpegData(compressionQuality: 0.85) ?? data
            let name = "image_\(Int(Date().timeIntervalSince1970)).jpg"
            vm.upload(data: jpeg, fileName: name, mimeType: "image/jpeg", localType: "image", preview: image)
        }
    }

    private func handleFile(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result, let url = urls.first else { return }
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        vm.upload(data: data, fileName: url.lastPathComponent, mimeType: mime, localType: "file", preview: nil)
    }
}

// MARK: - 气泡
private struct MessageBubble: View {
    let msg: Message
    let isMine: Bool
    let vm: ChatViewModel

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            if isMine { Spacer(minLength: 40) } else {
                InitialAvatar(name: msg.senderName.isEmpty ? "?" : msg.senderName, size: 36)
            }
            VStack(alignment: isMine ? .trailing : .leading, spacing: 2) {
                if !isMine && !msg.senderName.isEmpty {
                    Text(msg.senderName).font(.caption2).foregroundColor(.vxinTextSecondary)
                }
                if let rt = msg.replyTo {
                    Text("\(rt.senderName): \(replyPreview(rt))")
                        .font(.caption2).foregroundColor(.vxinTextSecondary)
                        .lineLimit(1)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Color.gray.opacity(0.15)).clipShape(RoundedRectangle(cornerRadius: 6))
                }
                content
                    .contextMenu {
                        ForEach(["👍", "❤️", "😂", "😮", "😢", "🙏"], id: \.self) { e in
                            Button(e) { vm.react(msg, emoji: e) }
                        }
                        Divider()
                        if msg.type == "text" {
                            Button("复制") { UIPasteboard.general.string = msg.content }
                        }
                        Button("回复") { vm.startReply(msg) }
                        if msg.type == "image" {
                            Button("收藏表情") { vm.collectSticker(msg.fileUrl) }
                        }
                        if isMine {
                            Button("撤回", role: .destructive) { vm.recall(msg) }
                        }
                    }
                if !msg.reactions.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(msg.reactions, id: \.emoji) { r in
                            Text("\(r.emoji) \(r.count)")
                                .font(.caption2)
                                .padding(.horizontal, 6).padding(.vertical, 1)
                                .background(Color.gray.opacity(0.15)).clipShape(Capsule())
                        }
                    }
                }
                if isMine {
                    let read = vm.isReadByPeer(msg)
                    Text(read ? "✓✓ 已读" : "✓")
                        .font(.caption2)
                        .foregroundColor(read ? .vxinGreen : .vxinTextSecondary)
                }
            }
            if !isMine { Spacer(minLength: 40) } else {
                InitialAvatar(name: msg.senderName.isEmpty ? "我" : msg.senderName, size: 36)
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch msg.type {
        case "image":
            KFImage(URL(string: vm.resolveMediaUrl(msg.fileUrl) ?? ""))
                .resizable()
                .scaledToFit()
                .frame(maxWidth: 220, maxHeight: 280)
                .clipShape(RoundedRectangle(cornerRadius: 10))
        case "voice":
            card { Text("🎙 语音  ▶") }.onTapGesture { vm.playVoice(msg) }
        case "file":
            card { Text("📄 \(msg.content.isEmpty ? "文件" : msg.content)").lineLimit(2) }
                .onTapGesture { openFile() }
        case "video":
            card { Text("🎬 视频") }.onTapGesture { openFile() }
        default:
            card { Text(msg.content) }
        }
    }

    private func replyPreview(_ rt: ReplyPreview) -> String {
        switch rt.type {
        case "image": return "[图片]"; case "voice": return "[语音]"
        case "video": return "[视频]"; case "file": return "[文件]"
        default: return rt.content
        }
    }

    private func card<V: View>(@ViewBuilder _ inner: () -> V) -> some View {
        inner()
            .foregroundColor(isMine ? .white : .primary)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(isMine ? Color.vxinGreen : Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func openFile() {
        if let s = vm.resolveMediaUrl(msg.fileUrl), let url = URL(string: s) {
            UIApplication.shared.open(url)
        }
    }
}

private struct PendingBubbleView: View {
    let pending: PendingUpload
    let onDismiss: () -> Void

    var body: some View {
        HStack {
            Spacer(minLength: 40)
            Group {
                if let image = pending.previewImage, !pending.failed {
                    ZStack {
                        Image(uiImage: image).resizable().scaledToFit()
                            .frame(maxWidth: 200, maxHeight: 240)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        ProgressView().tint(.white)
                    }
                } else {
                    HStack(spacing: 8) {
                        if !pending.failed { ProgressView().tint(.white) }
                        Text(pending.failed ? "上传失败（点击移除）" : label)
                            .foregroundColor(.white)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(pending.failed ? Color.vxinError.opacity(0.7) : Color.vxinGreen.opacity(0.6))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .onTapGesture { if pending.failed { onDismiss() } }
                }
            }
        }
    }

    private var label: String {
        switch pending.type {
        case "image": return "图片上传中…"
        case "voice": return "语音上传中…"
        case "video": return "视频上传中…"
        default: return "\(pending.name) 上传中…"
        }
    }
}
