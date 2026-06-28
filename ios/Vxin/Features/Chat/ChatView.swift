import SwiftUI
import UIKit
import PhotosUI
import UniformTypeIdentifiers
import Kingfisher

struct ChatView: View {
    @StateObject private var vm: ChatViewModel
    @EnvironmentObject private var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var photoItem: PhotosPickerItem?
    @State private var bgPhotoItem: PhotosPickerItem?
    @State private var showFileImporter = false
    @State private var showStickerPanel = false
    @State private var showRedPacketSend = false
    @State private var showPinnedList = false
    @State private var editText = ""
    @State private var forwardSelected = Set<String>()
    @State private var showMentionPicker = false
    private let isGroup: Bool
    private let onOpenGroupInfo: () -> Void

    init(conversation: Conversation, myId: String, onOpenGroupInfo: @escaping () -> Void = {}) {
        self.isGroup = conversation.type == "group"
        self.onOpenGroupInfo = onOpenGroupInfo
        _vm = StateObject(wrappedValue: ChatViewModel(
            conversationId: conversation.id,
            title: conversation.name,
            myId: myId,
            isGroup: conversation.type == "group",
            peerUserId: conversation.peerId   // 私聊对端id,使通话发起可靠(对端未发言也能拨)
        ))
    }

    var body: some View {
        VStack(spacing: 0) {
            if !vm.pinnedMessages.isEmpty { pinnedBanner }
            messageList
                .background(alignment: .center) {
                    if !vm.background.isEmpty, let url = URL(string: vm.resolveMediaUrl(vm.background) ?? "") {
                        KFImage(url).resizable().scaledToFill().clipped().ignoresSafeArea()
                    }
                }
            inputBar
        }
        .navigationTitle(vm.peerTyping ? "对方正在输入…" : (vm.title.isEmpty ? "聊天" : vm.title))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if isGroup {
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    Button { vm.startGroupCall(video: false) } label: { Image(systemName: "phone.fill") }
                        .accessibilityIdentifier("chat-call-audio-btn")
                    Button { vm.startGroupCall(video: true) } label: { Image(systemName: "video.fill") }
                        .accessibilityIdentifier("chat-call-video-btn")
                    Button(action: onOpenGroupInfo) { Image(systemName: "ellipsis") }
                }
            } else {
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    Button { _ = vm.startCall(video: false, callerName: session.currentUser?.username ?? "") } label: {
                        Image(systemName: "phone.fill")
                    }
                    .accessibilityIdentifier("chat-call-audio-btn")
                    Button { _ = vm.startCall(video: true, callerName: session.currentUser?.username ?? "") } label: {
                        Image(systemName: "video.fill")
                    }
                    .accessibilityIdentifier("chat-call-video-btn")
                }
            }
            // 聊天背景设置
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    PhotosPicker(selection: $bgPhotoItem, matching: .images) {
                        Label(vm.background.isEmpty ? "设置聊天背景" : "更换聊天背景", systemImage: "photo")
                    }
                    if !vm.background.isEmpty {
                        Button(role: .destructive) { vm.clearBackground() } label: { Label("清除聊天背景", systemImage: "trash") }
                    }
                } label: { Image(systemName: "photo.on.rectangle") }
            }
        }
        .onChange(of: bgPhotoItem) { item in handleBgPhoto(item) }
        .onChange(of: vm.input) { _ in vm.userIsTyping() }
        .onChange(of: vm.closed) { closed in if closed { dismiss() } }
        .onDisappear { vm.onLeave() }
        .onChange(of: photoItem) { item in handlePhoto(item) }
        .fileImporter(isPresented: $showFileImporter, allowedContentTypes: [.item], allowsMultipleSelection: false) { result in
            handleFile(result)
        }
        .sheet(isPresented: $showRedPacketSend) {
            SendRedPacketSheet { amount, count, greeting in
                vm.sendRedPacket(totalAmount: amount, totalCount: count, greeting: greeting)
                showRedPacketSend = false
            }
        }
        .sheet(isPresented: Binding(get: { vm.redPacketDetail != nil }, set: { if !$0 { vm.closeRedPacket() } })) {
            if let detail = vm.redPacketDetail {
                RedPacketDetailSheet(
                    detail: detail,
                    claimedAmount: vm.claimedAmount,
                    onClaim: { vm.claimOpenedRedPacket() },
                    onClose: { vm.closeRedPacket() }
                )
            }
        }
        .sheet(isPresented: $showPinnedList) {
            NavigationStack {
                List(vm.pinnedMessages) { p in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p.senderName.isEmpty ? "成员" : p.senderName).font(.caption).foregroundColor(.vxinTextSecondary)
                            Text(pinnedPreview(p)).lineLimit(2)
                        }
                        Spacer()
                        Button("取消", role: .destructive) { vm.unpinMessage(p.msgId) }.buttonStyle(.borderless)
                    }
                }
                .navigationTitle("置顶消息 (\(vm.pinnedMessages.count))")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { showPinnedList = false } } }
            }
        }
        .alert("编辑消息", isPresented: Binding(get: { vm.editTarget != nil }, set: { if !$0 { vm.editTarget = nil } })) {
            TextField("内容", text: $editText)
            Button("取消", role: .cancel) { vm.editTarget = nil }
            Button("保存") { if let m = vm.editTarget { vm.editMessage(m, newText: editText) }; vm.editTarget = nil }
        }
        .onChange(of: vm.editTarget?.id) { _ in editText = vm.editTarget?.content ?? "" }
        .fullScreenCover(isPresented: Binding(get: { vm.galleryImages != nil }, set: { if !$0 { vm.galleryImages = nil } })) {
            if let imgs = vm.galleryImages { ChatImageGalleryView(images: imgs, start: vm.galleryStart) { vm.galleryImages = nil } }
        }
        .sheet(isPresented: $showMentionPicker) {
            NavigationStack {
                List(vm.groupMembers) { m in
                    Button { vm.appendMention(m); showMentionPicker = false } label: {
                        HStack(spacing: 12) {
                            InitialAvatar(name: m.displayName.isEmpty ? "?" : m.displayName, size: 36)
                            Text(m.displayName.isEmpty ? "未命名" : m.displayName).foregroundColor(.primary)
                        }
                    }
                }
                .navigationTitle("选择要 @ 的成员").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { showMentionPicker = false } } }
            }
        }
        .sheet(isPresented: Binding(get: { vm.forwardTarget != nil }, set: { if !$0 { vm.forwardTarget = nil } })) {
            NavigationStack {
                List(vm.forwardTargets) { conv in
                    Button {
                        if forwardSelected.contains(conv.id) { forwardSelected.remove(conv.id) } else { forwardSelected.insert(conv.id) }
                    } label: {
                        HStack {
                            Image(systemName: forwardSelected.contains(conv.id) ? "checkmark.circle.fill" : "circle").foregroundColor(.vxinGreen)
                            InitialAvatar(name: conv.name.isEmpty ? "?" : conv.name, size: 32)
                            Text(conv.name.isEmpty ? "未命名会话" : conv.name).foregroundColor(.primary).lineLimit(1)
                        }
                    }
                }
                .navigationTitle("转发到").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("取消") { vm.forwardTarget = nil; forwardSelected = [] } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("转发") {
                            if let m = vm.forwardTarget { vm.forward(m, conversationIds: Array(forwardSelected)) }
                            vm.forwardTarget = nil; forwardSelected = []
                        }.disabled(forwardSelected.isEmpty)
                    }
                }
            }
        }
    }

    private var pinnedBanner: some View {
        Button { showPinnedList = true } label: {
            HStack(spacing: 8) {
                Text("📌").font(.caption)
                Text(vm.pinnedMessages.first.map(pinnedPreview) ?? "").lineLimit(1).font(.footnote)
                Spacer()
                if vm.pinnedMessages.count > 1 { Text("\(vm.pinnedMessages.count) 条").font(.caption).foregroundColor(.vxinTextSecondary) }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            .background(Color(red: 1.0, green: 0.97, blue: 0.9))
        }
        .buttonStyle(.plain)
    }

    private func pinnedPreview(_ p: PinnedMessage) -> String {
        switch p.type {
        case "image": return "[图片]"; case "voice": return "[语音]"; case "video": return "[视频]"
        case "file": return "[文件]"; case "red_packet": return "[红包]"
        default: return p.content
        }
    }

    // MARK: - 消息列表
    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 8) {
                    if !vm.reachedStart && !vm.messages.isEmpty {
                        Group {
                            if vm.loadingEarlier { ProgressView() }
                            else { Button("查看更早消息") { vm.loadEarlier() }.foregroundColor(.vxinGreen) }
                        }
                        .padding(.vertical, 8)
                    }
                    ForEach(vm.messages) { msg in
                        if msg.type == "nudge" {
                            Text(vm.nudgeText(msg))
                                .font(.caption).foregroundColor(.vxinTextSecondary)
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.vertical, 4)
                                .id(msg.id)
                        } else {
                            MessageBubble(msg: msg, isMine: msg.senderId == vm.myId, vm: vm)
                                .id(msg.id)
                                .accessibilityIdentifier("msg-bubble-\(msg.id)")
                        }
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
            // 仅最新一条变化时滚到底，避免加载更早(前插)跳动
            .onChange(of: vm.messages.last?.id) { _ in withAnimation { proxy.scrollTo(bottomAnchor, anchor: .bottom) } }
            .onChange(of: vm.pending.count) { _ in withAnimation { proxy.scrollTo(bottomAnchor, anchor: .bottom) } }
            .onChange(of: vm.scrollTarget) { target in
                if let target { withAnimation { proxy.scrollTo(target, anchor: .center) }; vm.scrollTarget = nil }
            }
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
                if vm.isGroup {
                    Button { showMentionPicker = true } label: { Text("@").font(.title3) }
                }
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Text("🖼").font(.title3)
                }
                .accessibilityIdentifier("chat-attach-image")
                Button { showFileImporter = true } label: { Text("📎").font(.title3) }
                Button { showRedPacketSend = true } label: { Text("🧧").font(.title3) }
                Button { onMicTap() } label: { Text(vm.recording ? "⏹" : "🎤").font(.title3) }
                    .accessibilityIdentifier("chat-voice-btn")

                TextField("输入消息…", text: $vm.input, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)
                    .accessibilityIdentifier("chat-msg-input")

                Button { vm.sendText() } label: {
                    if vm.sending { ProgressView() }
                    else { Image(systemName: "paperplane.fill").foregroundColor(vm.input.isEmpty ? .vxinTextSecondary : .vxinGreen) }
                }
                .disabled(vm.input.isEmpty || vm.sending)
                .accessibilityIdentifier("chat-send-btn")
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

    private func handleBgPhoto(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            defer { bgPhotoItem = nil }
            guard let data = try? await item.loadTransferable(type: Data.self) else { return }
            let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.85) ?? data
            let name = "bg_\(Int(Date().timeIntervalSince1970)).jpg"
            vm.setBackground(data: jpeg, fileName: name)
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
                    .onTapGesture(count: 2) { vm.nudge(msg.senderId) }
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
                        .onTapGesture { if !rt.id.isEmpty { vm.jumpTo(rt.id) } }
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
                        if msg.type != "red_packet" {
                            Button("转发") { vm.loadForwardTargets(); vm.forwardTarget = msg }
                            Button("收藏") { vm.collectMessage(msg) }
                        }
                        if vm.canEdit(msg) {
                            Button("编辑") { vm.editTarget = msg }
                        }
                        if vm.isGroup {
                            Button(vm.isPinned(msg.id) ? "取消置顶" : "置顶") {
                                if vm.isPinned(msg.id) { vm.unpinMessage(msg.id) } else { vm.pinMessage(msg) }
                            }
                        }
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
                if msg.edited == 1 {
                    Text("已编辑").font(.caption2).foregroundColor(.vxinTextSecondary)
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
        .padding(.vertical, 2)
        .background(vm.highlightedId == msg.id ? Color.vxinGreen.opacity(0.18) : Color.clear)
        .animation(.easeInOut, value: vm.highlightedId)
    }

    @ViewBuilder private var content: some View {
        switch msg.type {
        case "image":
            KFImage(URL(string: vm.resolveMediaUrl(msg.fileUrl) ?? ""))
                .resizable()
                .scaledToFit()
                .frame(maxWidth: 220, maxHeight: 280)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .onTapGesture { vm.openImage(msg) }
        case "voice":
            card { Text("🎙 语音  ▶") }.onTapGesture { vm.playVoice(msg) }
        case "file":
            card { Text("📄 \(msg.content.isEmpty ? "文件" : msg.content)").lineLimit(2) }
                .onTapGesture { openFile() }
        case "video":
            card { Text("🎬 视频") }.onTapGesture { openFile() }
        case "red_packet":
            redPacketCard.onTapGesture { vm.openRedPacket(msg) }
        default:
            card { Text(mentionHighlighted(msg.content, mine: isMine)) }
        }
    }

    /// 高亮 @用户名
    private func mentionHighlighted(_ text: String, mine: Bool) -> AttributedString {
        guard text.contains("@"), let re = try? NSRegularExpression(pattern: "@[^\\s@]+") else { return AttributedString(text) }
        let color: Color = .vxinGreen   // @提及高亮：浅绿/白气泡上都用品牌绿，保证可读
        let ns = text as NSString
        var result = AttributedString("")
        var last = 0
        re.enumerateMatches(in: text, range: NSRange(location: 0, length: ns.length)) { m, _, _ in
            guard let m = m else { return }
            if m.range.location > last {
                result += AttributedString(ns.substring(with: NSRange(location: last, length: m.range.location - last)))
            }
            var token = AttributedString(ns.substring(with: m.range))
            token.foregroundColor = color
            token.font = .body.bold()
            result += token
            last = m.range.location + m.range.length
        }
        if last < ns.length { result += AttributedString(ns.substring(from: last)) }
        return result
    }

    @ViewBuilder private var redPacketCard: some View {
        let rp = vm.parseRedPacket(msg)
        HStack(spacing: 10) {
            Text("🧧").font(.system(size: 28))
            VStack(alignment: .leading, spacing: 2) {
                Text(rp?.greeting.isEmpty == false ? rp!.greeting : "恭喜发财，大吉大利")
                    .foregroundColor(.white).font(.subheadline).lineLimit(1)
                Text("领取红包").foregroundColor(Color(red: 0.99, green: 0.89, blue: 0.66)).font(.caption)
            }
        }
        .padding(12)
        .frame(maxWidth: 240, alignment: .leading)
        .background(Color(red: 0.91, green: 0.31, blue: 0.23))
        .clipShape(RoundedRectangle(cornerRadius: 10))
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
            // 对齐 web/微信：我的=浅绿#95EC69+深字；对方=系统浅底(暗色自适应)+主色字
            .foregroundColor(isMine ? Color.vxinBubbleText : .primary)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(isMine ? Color.vxinBubbleMine : Color(.secondarySystemBackground))
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

// MARK: - 发红包
private struct SendRedPacketSheet: View {
    var onSend: (Int, Int, String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var amount = ""
    @State private var count = "1"
    @State private var greeting = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                TextField("总金币 (1-20000)", text: $amount).keyboardType(.numberPad)
                TextField("红包个数 (1-100)", text: $count).keyboardType(.numberPad)
                TextField("祝福语（可选）", text: $greeting)
                if let error { Text(error).foregroundColor(.vxinError).font(.footnote) }
            }
            .navigationTitle("发红包")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("塞钱进红包") {
                        let a = Int(amount) ?? 0, c = Int(count) ?? 0
                        error = validate(a, c)
                        if error == nil { onSend(a, c, String(greeting.prefix(100))) }
                    }
                }
            }
        }
    }

    private func validate(_ a: Int, _ c: Int) -> String? {
        if a < 1 || a > 20000 { return "总金币范围 1-20000" }
        if c < 1 || c > 100 { return "红包个数 1-100" }
        if a < c { return "总金币不能小于红包个数" }
        return nil
    }
}

// MARK: - 全屏图片画廊（多图左右滑，双指缩放，点击关闭）
private struct ChatImageGalleryView: View {
    let images: [String]
    let start: Int
    var onClose: () -> Void
    @State private var page = 0
    @State private var scale: CGFloat = 1

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            TabView(selection: $page) {
                ForEach(Array(images.enumerated()), id: \.offset) { idx, url in
                    KFImage(URL(string: url))
                        .resizable().scaledToFit()
                        .scaleEffect(idx == page ? scale : 1)
                        .gesture(MagnificationGesture().onChanged { scale = max(1, min($0, 4)) }.onEnded { _ in if scale < 1 { scale = 1 } })
                        .tag(idx)
                        .onTapGesture { onClose() }
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()
            HStack {
                Button { onClose() } label: { Image(systemName: "xmark").foregroundColor(.white).padding() }
                Spacer()
                if images.count > 1 { Text("\(page + 1)/\(images.count)").foregroundColor(.white).padding() }
            }
        }
        .onAppear { page = min(max(start, 0), max(images.count - 1, 0)) }
    }
}

// MARK: - 红包详情 / 领取
private struct RedPacketDetailSheet: View {
    let detail: RedPacketDetail
    let claimedAmount: Int?
    var onClaim: () -> Void
    var onClose: () -> Void

    private var canClaim: Bool { detail.myClaim == nil && claimedAmount == nil && detail.claimedCount < detail.totalCount }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Text("🧧").font(.system(size: 44))
                Text("\(detail.senderName.isEmpty ? "好友" : detail.senderName) 的红包").font(.headline)
                Text(detail.greeting.isEmpty ? "恭喜发财，大吉大利" : detail.greeting)
                    .foregroundColor(.vxinTextSecondary)

                if let mine = detail.myClaim {
                    Text("你领取了 \(mine.amount) 金币").font(.title3).foregroundColor(Color(red: 0.91, green: 0.31, blue: 0.23))
                } else if let claimedAmount {
                    Text("你领取了 \(claimedAmount) 金币").font(.title3).foregroundColor(Color(red: 0.91, green: 0.31, blue: 0.23))
                } else if detail.claimedCount >= detail.totalCount {
                    Text("手慢了，红包已被领完").foregroundColor(.vxinTextSecondary)
                }

                if canClaim {
                    Button(action: onClaim) {
                        Text("开").font(.title2).foregroundColor(.white)
                            .frame(width: 80, height: 80)
                            .background(Color(red: 0.91, green: 0.31, blue: 0.23)).clipShape(Circle())
                    }
                }

                Text("已领 \(detail.claimedCount)/\(detail.totalCount) 个").font(.caption).foregroundColor(.vxinTextSecondary)

                if !detail.claims.isEmpty {
                    List(detail.claims) { c in
                        HStack {
                            Text(c.username.isEmpty ? "用户" : c.username)
                            Spacer()
                            Text("\(c.amount) 金币").foregroundColor(Color(red: 0.91, green: 0.31, blue: 0.23))
                        }
                    }
                    .listStyle(.plain)
                } else {
                    Spacer()
                }
            }
            .padding()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("关闭") { onClose() } }
            }
        }
    }
}
