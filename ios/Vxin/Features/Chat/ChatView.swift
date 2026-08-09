import SwiftUI
import UIKit
import PhotosUI
import UniformTypeIdentifiers
import Kingfisher

struct ChatView: View {
    // 阅后即焚选项（对齐 Web BURN_OPTIONS）。
    static let burnOptions: [(Int, String)] = [
        (0, "关闭"), (10, "10秒"), (30, "30秒"), (60, "1分钟"),
        (300, "5分钟"), (3600, "1小时"), (86400, "24小时"), (604800, "7天"),
    ]
    static func burnLabel(_ seconds: Int) -> String { burnOptions.first { $0.0 == seconds }?.1 ?? "\(seconds)秒" }

    @StateObject private var vm: ChatViewModel
    @EnvironmentObject private var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var photoItem: PhotosPickerItem?
    @State private var bgPhotoItem: PhotosPickerItem?
    @State private var stickerPhotoItem: PhotosPickerItem?
    @State private var showFileImporter = false
    @State private var showStickerPanel = false
    @State private var showFuncPanel = false
    @State private var showRedPacketSend = false
    @State private var showTransferSend = false          // 好友转账弹窗
    @State private var showScheduleSend = false          // 定时发送弹窗
    @State private var showScheduleList = false          // 定时消息列表弹窗
    @State private var showConversationFiles = false      // 聊天文件聚合全屏页
    @State private var exportShareURL: URL?               // 导出的临时 txt 文件 URL
    @State private var showExportShare = false            // 分享面板开关
    @State private var showPinnedList = false
    @State private var showAnnouncement = false
    @State private var editText = ""
    @State private var forwardSelected = Set<String>()
    @State private var showMentionPicker = false
    @State private var atBottom = true          // 用户是否在底部附近(决定新消息是否自动滚底)
    @State private var newMsgCount = 0          // 看历史期间累计的新消息数(悬浮提示)
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
            if !vm.groupAnnouncement.isEmpty { announcementBanner }
            if !vm.pinnedMessages.isEmpty { pinnedBanner }
            messageList
                .background(alignment: .center) {
                    if !vm.background.isEmpty, let src = MediaUrlResolver.kfSource(resolved: vm.resolveMediaUrl(vm.background)) {
                        KFImage(source: src).resizable().scaledToFill().clipped().ignoresSafeArea()
                    }
                }
            if vm.multiSelect {
                multiSelectBar
            } else {
                inputBar
            }
        }
        .navigationTitle(vm.peerTyping ? "对方正在输入…" : (vm.title.isEmpty ? "聊天" : vm.title))
        .navigationBarTitleDisplayMode(.inline)
        .toast($vm.error)   // 发送/上传/收藏/转发等失败与"已收藏""已转发"等提示统一透出
        .toolbar {
            if isGroup {
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    // 群语音/群视频按钮受后台开关控制，关闭即隐藏
                    if vm.groupVoiceCallEnabled {
                        Button { vm.startGroupCall(video: false) } label: { Image(systemName: "phone.fill") }
                            .accessibilityIdentifier("chat-call-audio-btn")
                            .accessibilityLabel("语音通话")
                    }
                    if vm.groupVideoCallEnabled {
                        Button { vm.startGroupCall(video: true) } label: { Image(systemName: "video.fill") }
                            .accessibilityIdentifier("chat-call-video-btn")
                            .accessibilityLabel("视频通话")
                    }
                    Button(action: onOpenGroupInfo) { Image(systemName: "ellipsis") }
                        .accessibilityLabel("群聊信息")
                }
            } else {
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    Button { _ = vm.startCall(video: false, callerName: session.currentUser?.username ?? "") } label: {
                        Image(systemName: "phone.fill")
                    }
                    .accessibilityIdentifier("chat-call-audio-btn")
                    .accessibilityLabel("语音通话")
                    Button { _ = vm.startCall(video: true, callerName: session.currentUser?.username ?? "") } label: {
                        Image(systemName: "video.fill")
                    }
                    .accessibilityIdentifier("chat-call-video-btn")
                    .accessibilityLabel("视频通话")
                }
            }
            // 会话内消息搜索
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { vm.openSearch() } label: { Image(systemName: "magnifyingglass") }
                    .accessibilityIdentifier("chat-search-btn")
                    .accessibilityLabel("搜索聊天记录")
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
                    Menu {
                        ForEach(ChatView.burnOptions, id: \.0) { secs, label in
                            Button {
                                vm.setBurnAfter(secs)
                            } label: {
                                if vm.burnAfter == secs { Label(label, systemImage: "checkmark") } else { Text(label) }
                            }
                        }
                    } label: {
                        Label("阅后即焚" + (vm.burnAfter > 0 ? "（\(ChatView.burnLabel(vm.burnAfter))）" : ""), systemImage: "flame")
                    }
                    Divider()
                    // 聊天文件聚合：图片/视频/文件汇总全屏页
                    Button {
                        showConversationFiles = true
                    } label: {
                        Label("聊天文件", systemImage: "folder")
                    }
                    .accessibilityIdentifier("chat-files-btn")
                    // 导出聊天记录：拉取全量文本存 txt 并分享
                    Button {
                        vm.exportChat()
                    } label: {
                        Label(vm.exportingChat ? "导出中…" : "导出聊天记录", systemImage: "square.and.arrow.up")
                    }
                    .disabled(vm.exportingChat)
                    .accessibilityIdentifier("chat-export-btn")
                } label: { Image(systemName: "photo.on.rectangle") }
                .accessibilityLabel("聊天设置")
            }
        }
        .onChange(of: bgPhotoItem) { item in handleBgPhoto(item) }
        .onChange(of: stickerPhotoItem) { item in handleStickerPhoto(item) }
        .onChange(of: vm.input) { newVal in
            // 粘贴多行文本时把换行折叠为空格，消息始终保持单行高度
            let normalized = newVal.replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\r", with: " ")
            if normalized != newVal { vm.input = normalized }
            vm.userIsTyping()
        }
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
        .sheet(isPresented: $showTransferSend) {
            SendTransferSheet(sending: vm.sendingTransfer) { amount, note in
                guard let peer = vm.transferPeerId() else { vm.error = "无法确定转账对象"; return }
                vm.sendTransfer(toUserId: peer, amount: amount, note: note)
                showTransferSend = false
            }
        }
        .sheet(isPresented: $showScheduleSend) {
            SendScheduleSheet(sending: vm.sendingSchedule) { content, sendAt in
                vm.scheduleMessage(content: content, sendAt: sendAt)
                showScheduleSend = false
            }
        }
        .sheet(isPresented: $showScheduleList) {
            ScheduledListSheet(vm: vm)
        }
        // 导出聊天记录：拿到文本后写入临时 txt 文件并调起系统分享
        .onChange(of: vm.exportContent) { content in
            guard let content else { return }
            exportShareURL = writeExportFile(content)
            vm.clearExportContent()
            if exportShareURL != nil { showExportShare = true } else { vm.error = "导出失败" }
        }
        .sheet(isPresented: $showExportShare) {
            if let url = exportShareURL { ShareSheet(items: [url]) }
        }
        // 聊天文件聚合全屏页
        .fullScreenCover(isPresented: $showConversationFiles) {
            ConversationFilesView(conversationId: vm.conversationId)
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
        .sheet(isPresented: $showAnnouncement) {
            NavigationStack {
                ScrollView {
                    Text(vm.groupAnnouncement)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                }
                .navigationTitle("群公告")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { showAnnouncement = false } } }
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
        .sheet(isPresented: $vm.searchActive, onDismiss: { vm.closeSearch() }) {
            MessageSearchSheet(vm: vm)
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
                List {
                    // 群主/管理员专属：@所有人（置顶入口）
                    if vm.canManageGroup {
                        Button { vm.appendMentionAll(); showMentionPicker = false } label: {
                            HStack(spacing: 12) {
                                InitialAvatar(name: "全", size: 36)
                                Text("所有人").fontWeight(.semibold).foregroundColor(.primary)
                            }
                        }
                    }
                    ForEach(vm.groupMembers) { m in
                        Button { vm.appendMention(m); showMentionPicker = false } label: {
                            HStack(spacing: 12) {
                                InitialAvatar(name: m.displayName.isEmpty ? "?" : m.displayName, size: 36)
                                Text(m.displayName.isEmpty ? "未命名" : m.displayName).foregroundColor(.primary)
                            }
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

    private var announcementBanner: some View {
        Button { showAnnouncement = true } label: {
            HStack(spacing: 8) {
                Text("📢").font(.caption)
                Text("群公告").font(.caption).foregroundColor(.vxinInfoBannerFg)
                MarqueeText(text: vm.groupAnnouncement.replacingOccurrences(of: "\n", with: "   "), font: .footnote)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(red: 0.92, green: 0.96, blue: 1.0))
        }
        .buttonStyle(.plain)
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
        case "file": return "[文件]"; case "red_packet": return "[红包]"; case "transfer": return "[转账]"
        case "sticker": return "[表情]"; case "contact_card", "contact": return "[名片]"
        default: return p.content
        }
    }

    // MARK: - 消息列表
    private var messageList: some View {
        ScrollViewReader { proxy in
            ZStack(alignment: .bottomTrailing) {
            ScrollView {
                LazyVStack(spacing: 8) {
                    if !vm.reachedStart && !vm.messages.isEmpty {
                        Group {
                            if vm.loadingEarlier { ProgressView() }
                            else { Button("查看更早消息") { vm.loadEarlier() }.foregroundColor(.vxinGreen) }
                        }
                        .padding(.vertical, 8)
                    }
                    ForEach(Array(vm.messages.enumerated()), id: \.element.id) { idx, msg in
                        // 时间分隔：与上一条间隔超 5 分钟显示居中时间(对齐微信 + 安卓)
                        let prev = idx > 0 ? vm.messages[idx - 1].createdAt : nil
                        if shouldShowMessageTime(prev: prev, cur: msg.createdAt) {
                            Text(formatChatTime(msg.createdAt))
                                .font(.caption2).foregroundColor(.vxinTextSecondary)
                                .padding(.horizontal, 8).padding(.vertical, 2)
                                .background(Color.gray.opacity(0.12))
                                .clipShape(RoundedRectangle(cornerRadius: VxinRadius.sm))
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.vertical, 4)
                        }
                        if msg.type == "nudge" {
                            Text(vm.nudgeText(msg))
                                .font(.caption).foregroundColor(.vxinTextSecondary)
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.vertical, 4)
                                .id(msg.id)
                        } else if vm.multiSelect {
                            // 多选模式：整行可点勾选，左侧圆形指示器
                            HStack(spacing: 8) {
                                Image(systemName: vm.selectedIds.contains(msg.id) ? "checkmark.circle.fill" : "circle")
                                    .foregroundColor(vm.selectedIds.contains(msg.id) ? .vxinGreen : .secondary)
                                MessageBubble(msg: msg, isMine: msg.senderId == vm.myId, vm: vm)
                                    .allowsHitTesting(false)
                            }
                            .contentShape(Rectangle())
                            .onTapGesture { vm.toggleSelect(msg) }
                            .id(msg.id)
                        } else {
                            MessageBubble(msg: msg, isMine: msg.senderId == vm.myId, vm: vm)
                                .id(msg.id)
                                .accessibilityIdentifier("msg-bubble-\(msg.id)")
                        }
                    }
                    ForEach(vm.pending) { p in
                        PendingBubbleView(pending: p, onRetry: { vm.retryPending(p.id) }) { vm.dismissFailed(p.id) }
                            .id(p.id)
                    }
                    // 底部锚点：出现/消失用于判断用户是否在底部附近(对齐微信新消息提示)
                    Color.clear.frame(height: 1).id(bottomAnchor)
                        .onAppear { atBottom = true; vm.setAtBottom(true); withAnimation { newMsgCount = 0 } }
                        .onDisappear { atBottom = false; vm.setAtBottom(false) }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            // 最新一条变化：在底部则跟随滚底；在上方看历史则累计"N 条新消息"不打断
            .onChange(of: vm.messages.last?.id) { _ in
                guard let last = vm.messages.last else { return }
                if atBottom || last.senderId == vm.myId {
                    withAnimation { proxy.scrollTo(bottomAnchor, anchor: .bottom) }
                } else {
                    withAnimation { newMsgCount += 1 }
                }
            }
            .onChange(of: vm.pending.count) { _ in withAnimation { proxy.scrollTo(bottomAnchor, anchor: .bottom) } }
            .onChange(of: vm.scrollTarget) { target in
                if let target { withAnimation { proxy.scrollTo(target, anchor: .center) }; vm.scrollTarget = nil }
            }

            // 「↓ N 条新消息」悬浮按钮：看历史时来了新消息才显示，点按滚到底
            if newMsgCount > 0 {
                Button {
                    Haptics.impact(.light)   // 点按回底轻震反馈(对齐发送/长按)
                    withAnimation { proxy.scrollTo(bottomAnchor, anchor: .bottom) }
                    newMsgCount = 0
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.down")
                        Text("\(newMsgCount) 条新消息")
                    }
                    .font(.caption).foregroundColor(.vxinGreen)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(Capsule().fill(Color.vxinCard).shadow(color: .black.opacity(0.12), radius: 4, y: 2))
                }
                .padding(.trailing, 12).padding(.bottom, 8)
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }
            }
        }
    }

    private let bottomAnchor = "BOTTOM_ANCHOR"

    // MARK: - 多选底栏（批量撤回/删除，对齐 web）
    private var multiSelectBar: some View {
        HStack {
            Text("已选 \(vm.selectedIds.count) 条").font(.subheadline).foregroundColor(.vxinTextSecondary)
            Spacer()
            Button("取消") { vm.exitMultiSelect() }
            Button(role: .destructive) { vm.batchDeleteSelected() } label: { Text("删除") }
                .disabled(vm.selectedIds.isEmpty)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(.bar)
    }

    // MARK: - 输入栏
    private var inputBar: some View {
        VStack(spacing: 0) {
            if let r = vm.replyingTo {
                HStack {
                    Text("回复 \(r.senderName): \(replyPreviewText(r))")
                        .font(.caption).foregroundColor(.vxinTextSecondary).lineLimit(1)
                    Spacer()
                    Button { vm.cancelReply() } label: { Image(systemName: "xmark.circle.fill").foregroundColor(.vxinTextSecondary) }
                        .accessibilityLabel("取消引用")
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
            // 微信风格输入栏：[🎤][@?][输入框][😀][ + / 发送 ]
            HStack(spacing: 6) {
                Button { onMicTap() } label: { Text(vm.recording ? "⏹" : "🎤").font(.title3) }
                    .accessibilityIdentifier("chat-voice-btn")
                    .accessibilityLabel(vm.recording ? "停止录音" : "语音输入")
                if vm.isGroup {
                    Button { showMentionPicker = true } label: { Text("@").font(.title3) }
                        .accessibilityLabel("提及成员")
                }
                TextField("输入消息…", text: $vm.input, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)
                    .accessibilityIdentifier("chat-msg-input")

                Button {
                    showStickerPanel.toggle()
                    if showStickerPanel { showFuncPanel = false; vm.loadStickers() }
                } label: { Text(showStickerPanel ? "⌨️" : "😀").font(.title3) }
                    .accessibilityIdentifier("chat-emoji-btn")
                    .accessibilityLabel("表情")

                // 有文字 → 发送键；无文字(含纯空白) → +(功能面板)。对齐 Android/微信。
                let hasText = !vm.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                if hasText || vm.sending {
                    Button { vm.sendText() } label: {
                        if vm.sending { ProgressView() }
                        else { Image(systemName: "paperplane.fill").foregroundColor(.vxinGreen) }
                    }
                    .disabled(!hasText || vm.sending)
                    .accessibilityIdentifier("chat-send-btn")
                    .accessibilityLabel("发送")
                } else {
                    Button {
                        showFuncPanel.toggle()
                        if showFuncPanel { showStickerPanel = false }
                    } label: {
                        Image(systemName: showFuncPanel ? "xmark.circle" : "plus.circle")
                            .font(.title2).foregroundColor(.vxinTextSecondary)
                    }
                    .accessibilityIdentifier("chat-more-btn")
                    .accessibilityLabel("更多功能")
                }
            }
            .padding(8)

            if showStickerPanel {
                stickerEmojiPanel
            }
            if showFuncPanel {
                functionPanel
            }
        }
    }

    /// +面板：图片 / 文件 / 红包（对齐微信「更多功能」面板）
    private var functionPanel: some View {
        HStack(spacing: 24) {
            PhotosPicker(selection: $photoItem, matching: .images) {
                funcItem(emoji: "🖼", label: "图片")
            }
            .accessibilityIdentifier("chat-attach-image")
            .accessibilityLabel("发送图片")
            Button { showFuncPanel = false; showFileImporter = true } label: { funcItem(emoji: "📎", label: "文件") }
                .accessibilityIdentifier("chat-attach-file")
                .accessibilityLabel("发送文件")
            Button { showFuncPanel = false; showRedPacketSend = true } label: { funcItem(emoji: "🧧", label: "红包") }
                .accessibilityIdentifier("chat-attach-redpacket")
                .accessibilityLabel("发红包")
            // 转账仅私聊可用（群聊不显示）
            if !vm.isGroup {
                Button { showFuncPanel = false; showTransferSend = true } label: { funcItem(emoji: "💸", label: "转账") }
                    .accessibilityIdentifier("chat-attach-transfer")
                    .accessibilityLabel("转账")
            }
            // 定时发送：所有会话均可用
            Button { showFuncPanel = false; showScheduleSend = true } label: { funcItem(emoji: "⏰", label: "定时发送") }
                .accessibilityIdentifier("chat-attach-schedule")
                .accessibilityLabel("定时发送")
            Spacer()
        }
        .padding(.horizontal, 24).padding(.vertical, 16)
        .frame(maxWidth: .infinity)
        .background(Color.gray.opacity(0.08))
    }

    private func funcItem(emoji: String, label: String) -> some View {
        VStack(spacing: 6) {
            Text(emoji).font(.system(size: 26))
                .frame(width: 56, height: 56)
                .background(Color(.systemBackground))
                .clipShape(RoundedRectangle(cornerRadius: VxinRadius.md))
            Text(label).font(.caption).foregroundColor(.vxinTextSecondary)
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
            Divider()
            HStack {
                Text("我的表情").font(.caption).foregroundColor(.vxinTextSecondary)
                Spacer()
                PhotosPicker(selection: $stickerPhotoItem, matching: .images) {
                    Label("添加", systemImage: "plus").font(.caption).foregroundColor(.vxinGreen)
                }
            }
            .padding(.horizontal, 8)
            if !vm.stickers.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(vm.stickers) { s in
                            KFImage(source: MediaUrlResolver.kfSource(resolved: vm.resolveMediaUrl(s.url)))
                                .resizable().scaledToFit().frame(width: 60, height: 60)
                                .onTapGesture { vm.sendSticker(s); showStickerPanel = false }
                        }
                    }
                    .padding(.horizontal, 8)
                }
            } else {
                Text("还没有表情，点右上「添加」上传，或长按聊天图片「收藏表情」").font(.caption2).foregroundColor(.vxinTextSecondary).padding(8)
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
        case "red_packet": return "[红包]"; case "transfer": return "[转账]"; case "sticker": return "[表情]"
        case "contact_card", "contact": return "[名片]"
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

    private func handleStickerPhoto(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            defer { stickerPhotoItem = nil }
            guard let data = try? await item.loadTransferable(type: Data.self) else { return }
            let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.9) ?? data
            let name = "sticker_\(Int(Date().timeIntervalSince1970)).jpg"
            vm.uploadSticker(data: jpeg, fileName: name)
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

    /// 把导出文本写入临时目录的 chat-<会话id>.txt，返回文件 URL（供系统分享）。失败返回 nil。
    private func writeExportFile(_ content: String) -> URL? {
        let name = "chat-\(vm.conversationId).txt"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do {
            try content.data(using: .utf8)?.write(to: url)
            return url
        } catch {
            return nil
        }
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
                        .background(Color.gray.opacity(0.15)).clipShape(RoundedRectangle(cornerRadius: VxinRadius.sm))
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
                        // 红包/转账为资金凭证，不支持转发/收藏
                        if msg.type != "red_packet" && msg.type != "transfer" {
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
                            Button("复制图片") { copyImage(msg.fileUrl) }
                            Button("收藏表情") { vm.collectSticker(msg.fileUrl) }
                            Button("保存图片") { saveImage(msg.fileUrl) }
                        }
                        if isMine {
                            Button("撤回", role: .destructive) { vm.recall(msg) }
                            Button("删除不留痕迹", role: .destructive) { vm.vanish(msg) }
                        }
                        Divider()
                        Button("多选") { vm.enterMultiSelect(msg) }
                    }
                if !msg.reactions.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(msg.reactions, id: \.emoji) { r in
                            let mine = r.mine(vm.myId)
                            Text("\(r.emoji) \(r.count)")
                                .font(.caption2)
                                .foregroundColor(mine ? .vxinBrand : .primary)
                                .padding(.horizontal, 6).padding(.vertical, 1)
                                // 高亮「我」贴过的表情（对齐 Web .mine 样式）
                                .background(mine ? Color.vxinBrand.opacity(0.15) : Color.gray.opacity(0.15))
                                .overlay(Capsule().stroke(mine ? Color.vxinBrand.opacity(0.6) : .clear, lineWidth: 0.5))
                                .clipShape(Capsule())
                                .onTapGesture { vm.react(msg, emoji: r.emoji) }  // 点击切换回应（与 Web 一致）
                        }
                    }
                }
                if msg.edited == 1 {
                    Text("已编辑").font(.caption2).foregroundColor(.vxinTextSecondary)
                }
                if isMine {
                    if msg.localStatus == LocalMsgStatus.sending {
                        // 发送中：转圈（对齐 Web/Android）
                        ProgressView().scaleEffect(0.6).frame(height: 12)
                    } else if msg.localStatus == LocalMsgStatus.failed {
                        // 失败：红色感叹号，点击重发
                        Text("❗发送失败，点击重发")
                            .font(.caption2)
                            .foregroundColor(Color(red: 0.9, green: 0.27, blue: 0.27))
                            .onTapGesture { vm.retryMessage(msg.id) }
                    } else {
                        // 定时消息角标（is_scheduled=1）显示在已读状态上方
                        if msg.isScheduled == 1 {
                            Text("⏰ 定时")
                                .font(.caption2)
                                .foregroundColor(.vxinTextSecondary)
                        }
                        let read = vm.isReadByPeer(msg)
                        Text(read ? "✓✓ 已读" : "✓")
                            .font(.caption2)
                            .foregroundColor(read ? .vxinGreen : .vxinTextSecondary)
                    }
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

    private func saveImage(_ url: String?) {
        Task {
            do {
                try await ImageSaver.saveToPhotos(rawUrl: url)
                vm.error = "已保存到相册"
            } catch {
                vm.error = (error as? LocalizedError)?.errorDescription ?? "保存失败"
            }
        }
    }

    private func copyImage(_ url: String?) {
        Task {
            do {
                try await ImageSaver.copyToPasteboard(rawUrl: url)
                vm.error = "图片已复制"
            } catch {
                vm.error = (error as? LocalizedError)?.errorDescription ?? "复制失败"
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch msg.type {
        case "image":
            KFImage(source: MediaUrlResolver.kfSource(resolved: vm.resolveMediaUrl(msg.fileUrl)))
                .resizable()
                .scaledToFit()
                .frame(maxWidth: 220, maxHeight: 280)
                .clipShape(RoundedRectangle(cornerRadius: VxinRadius.badge))
                .onTapGesture { vm.openImage(msg) }
        case "voice":
            // 语音气泡 + 转文字三态（对齐 Android ChatScreen）
            VStack(alignment: isMine ? .trailing : .leading, spacing: 3) {
                card { Text("🎙 语音  ▶") }.onTapGesture { vm.playVoice(msg) }
                voiceTranscript
            }
        case "file":
            card { Text("📄 \(msg.content.isEmpty ? "文件" : msg.content)").lineLimit(2) }
                .onTapGesture { openFile() }
        case "video":
            card { Text("🎬 视频") }.onTapGesture { openFile() }
        case "red_packet":
            redPacketCard.onTapGesture { vm.openRedPacket(msg) }
        case "transfer":
            transferCard
        case "contact_card", "contact":
            card { Text("👤 \(contactCardTitle)") }
        default:
            card { Text(mentionHighlighted(msg.content, mine: isMine)) }
        }
    }

    /// 语音转文字三态（对齐 Android）：
    /// 1) 已转写(transcript 非空) → 直接显示灰底文本，无按钮
    /// 2) 转写中 → 「转写中…」
    /// 3) 未转写 → 绿色「转文字」小按钮，点击发起转写
    @ViewBuilder private var voiceTranscript: some View {
        if let text = msg.transcript, !text.isEmpty {
            Text(text)
                .font(.footnote).foregroundColor(.vxinTextSecondary)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .frame(maxWidth: 240, alignment: .leading)
                .background(Color.gray.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: VxinRadius.thumb))
        } else if vm.isTranscribing(msg.id) {
            Text("转写中…").font(.caption).foregroundColor(.vxinTextSecondary)
                .padding(.horizontal, 2)
        } else {
            Button { vm.transcribeVoice(msg) } label: {
                Text("转文字").font(.caption).foregroundColor(.vxinGreen)
                    .padding(.horizontal, 6).padding(.vertical, 2)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("voice-transcribe-\(msg.id)")
        }
    }

    /// 名片消息标题：昵称 · 个人名片（解析失败时仅显示"个人名片"），避免显示原始 JSON
    private var contactCardTitle: String {
        let name = vm.parseContactCard(msg)?.username ?? ""
        return name.isEmpty ? "个人名片" : "\(name) · 个人名片"
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
        .clipShape(RoundedRectangle(cornerRadius: VxinRadius.badge))
    }

    /// 转账气泡（绿色卡片，对齐 Android TransferCard）：自己发的显示「转账给xx ¥xx」，
    /// 对方发的显示「转账 ¥xx」；有备注显备注，无备注显「已到账」。转账即到账，无需点击领取。
    @ViewBuilder private var transferCard: some View {
        let t = vm.parseTransfer(msg)
        HStack(spacing: 10) {
            Text("💸").font(.system(size: 26))
            VStack(alignment: .leading, spacing: 2) {
                Text(transferTitle(t))
                    .foregroundColor(.white).font(.subheadline).lineLimit(1)
                if let note = t?.note, !note.isEmpty {
                    Text(note).foregroundColor(.white.opacity(0.8)).font(.caption).lineLimit(1)
                } else {
                    Text("已到账").foregroundColor(.white.opacity(0.75)).font(.caption)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: 240, alignment: .leading)
        .background(
            LinearGradient.vxinPay
        )
        .clipShape(RoundedRectangle(cornerRadius: VxinRadius.badge))
    }

    private func transferTitle(_ t: TransferContent?) -> String {
        let amount = t?.amount ?? 0
        if isMine, let name = t?.toUsername, !name.isEmpty {
            return "转账给 \(name)  ¥\(amount)"
        }
        return "转账  ¥\(amount)"
    }

    private func replyPreview(_ rt: ReplyPreview) -> String {
        if rt.deleted == 1 { return "消息已撤回" }   // 对齐 Web：被回复消息已撤回
        switch rt.type {
        case "image": return "[图片]"; case "voice": return "[语音]"
        case "video": return "[视频]"; case "file": return "[文件]"
        case "red_packet": return "[红包]"; case "transfer": return "[转账]"; case "sticker": return "[表情]"
        case "contact_card", "contact": return "[名片]"
        default: return rt.content
        }
    }

    private func card<V: View>(@ViewBuilder _ inner: () -> V) -> some View {
        inner()
            // 对齐 web AURORA：我的=极光靛渐变+白字；对方=系统浅底(暗色自适应)+主色字
            .foregroundColor(isMine ? Color.vxinBubbleText : .primary)
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background {
                if isMine {
                    LinearGradient.vxinBubble
                } else {
                    Color(.secondarySystemBackground)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: VxinRadius.md))
            .shadow(color: (isMine ? Color.vxinBrand : .black).opacity(isMine ? 0.28 : 0.06),
                    radius: isMine ? 5 : 3, y: 1)
    }

    private func openFile() {
        if let s = vm.resolveMediaUrl(msg.fileUrl), let url = URL(string: s) {
            UIApplication.shared.open(url)
        }
    }
}

private struct PendingBubbleView: View {
    let pending: PendingUpload
    var onRetry: () -> Void = {}
    let onDismiss: () -> Void

    var body: some View {
        HStack {
            Spacer(minLength: 40)
            // 失败时：气泡左侧红色感叹号，点击重试(对齐微信 + 安卓)
            if pending.failed {
                Button(action: onRetry) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundColor(.vxinError).font(.title3)
                }
                .buttonStyle(.plain)
            }
            Group {
                if let image = pending.previewImage, !pending.failed {
                    ZStack {
                        Image(uiImage: image).resizable().scaledToFit()
                            .frame(maxWidth: 200, maxHeight: 240)
                            .clipShape(RoundedRectangle(cornerRadius: VxinRadius.badge))
                        ProgressView().tint(.white)
                    }
                } else {
                    HStack(spacing: 8) {
                        if !pending.failed { ProgressView().tint(.white) }
                        Text(pending.failed ? "发送失败（点击重试，长按移除）" : label)
                            .foregroundColor(.white)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(pending.failed ? Color.vxinError.opacity(0.7) : Color.vxinGreen.opacity(0.6))
                    .clipShape(RoundedRectangle(cornerRadius: VxinRadius.badge))
                    .onTapGesture { if pending.failed { onRetry() } }
                    .onLongPressGesture { if pending.failed { onDismiss() } }
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

// MARK: - 发起转账（金额 1-20000 整数 + 备注 ≤50 字 + 确认）
private struct SendTransferSheet: View {
    let sending: Bool
    var onSend: (Int, String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var amount = ""
    @State private var note = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                TextField("金额（金币，1-20000）", text: $amount).keyboardType(.numberPad)
                TextField("备注（可选，≤50字）", text: $note)
                if let error { Text(error).foregroundColor(.vxinError).font(.footnote) }
            }
            .navigationTitle("转账")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(sending) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("确认转账") {
                        let a = Int(amount) ?? 0
                        error = (a < 1 || a > 20000) ? "金额范围 1-20000 金币" : nil
                        if error == nil { onSend(a, String(note.prefix(50))) }
                    }
                    .disabled(sending)
                }
            }
        }
    }
}

// MARK: - 定时发送（输入内容 + DatePicker，校验≥15分钟≤30天）
private struct SendScheduleSheet: View {
    let sending: Bool
    var onSend: (String, Date) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var content = ""
    // 默认 1 小时后
    @State private var sendAt = Date().addingTimeInterval(3600)
    @State private var error: String?

    /// 有效发送时间范围：≥15分钟后，≤30天
    private var minDate: Date { Date().addingTimeInterval(15 * 60) }
    private var maxDate: Date { Date().addingTimeInterval(30 * 24 * 3600) }

    var body: some View {
        NavigationStack {
            Form {
                Section("消息内容") {
                    TextField("请输入要定时发送的内容…", text: $content, axis: .vertical)
                        .lineLimit(3...6)
                        .accessibilityIdentifier("schedule-content-input")
                }
                Section("发送时间") {
                    DatePicker(
                        "发送时间",
                        selection: $sendAt,
                        in: minDate...maxDate,
                        displayedComponents: [.date, .hourAndMinute]
                    )
                    .datePickerStyle(.graphical)
                    .accessibilityIdentifier("schedule-date-picker")
                }
                if let error {
                    Section { Text(error).foregroundColor(.vxinError).font(.footnote) }
                }
                Section {
                    Text("仅抑制发送操作，聊天和已发消息不受影响。到点由服务器自动发出。")
                        .font(.caption)
                        .foregroundColor(.vxinTextSecondary)
                }
            }
            .navigationTitle("定时发送")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }.disabled(sending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("确定") {
                        let text = content.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !text.isEmpty else { error = "内容不能为空"; return }
                        guard sendAt >= minDate else { error = "发送时间须至少15分钟后"; return }
                        guard sendAt <= maxDate else { error = "发送时间不能超过30天"; return }
                        error = nil
                        onSend(text, sendAt)
                    }
                    .disabled(sending)
                }
            }
        }
    }
}

// MARK: - 定时消息列表（pending 可取消）
private struct ScheduledListSheet: View {
    @ObservedObject var vm: ChatViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if vm.loadingScheduledList {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if vm.scheduledList.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "clock").font(.system(size: 40)).foregroundColor(.vxinTextSecondary)
                        Text("暂无定时消息").foregroundColor(.vxinTextSecondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(vm.scheduledList) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(scheduledStatusLabel(item.status))
                                    .font(.caption2)
                                    .foregroundColor(item.status == "pending" ? .vxinGreen : .vxinTextSecondary)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background((item.status == "pending" ? Color.vxinGreen : Color.gray).opacity(0.12))
                                    .clipShape(Capsule())
                                Spacer()
                                Text(formatChatTime(item.sendAt))
                                    .font(.caption2).foregroundColor(.vxinTextSecondary)
                            }
                            Text(item.content).lineLimit(2)
                            if item.status == "pending" {
                                Button("取消定时") { vm.cancelScheduledMessage(item) }
                                    .font(.caption)
                                    .foregroundColor(.vxinError)
                                    .buttonStyle(.borderless)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("定时消息")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("关闭") { dismiss() }
                }
            }
            .task { vm.loadScheduledMessages() }
        }
    }

    private func scheduledStatusLabel(_ status: String) -> String {
        switch status {
        case "pending": return "待发送"
        case "sent": return "已发送"
        case "cancelled": return "已取消"
        default: return status
        }
    }
}

// MARK: - 系统分享面板（UIActivityViewController 封装，用于分享导出的 txt 文件）
private struct ShareSheet: UIViewControllerRepresentable {    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

// MARK: - 全屏图片画廊（多图左右滑，双指缩放，点击关闭）
private struct ChatImageGalleryView: View {
    let images: [String]
    let start: Int
    var onClose: () -> Void
    @State private var page = 0
    @State private var scale: CGFloat = 1
    @State private var saveToast: String?

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            TabView(selection: $page) {
                ForEach(Array(images.enumerated()), id: \.offset) { idx, url in
                    KFImage(source: MediaUrlResolver.kfSource(resolved: url))
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
                    .accessibilityLabel("关闭")
                Spacer()
                if images.count > 1 { Text("\(page + 1)/\(images.count)").foregroundColor(.white).padding() }
                Button {
                    Task {
                        do {
                            try await ImageSaver.saveToPhotos(rawUrl: images[page])
                            saveToast = "已保存到相册"
                        } catch {
                            saveToast = (error as? LocalizedError)?.errorDescription ?? "保存失败"
                        }
                    }
                } label: {
                    Image(systemName: "square.and.arrow.down")
                        .foregroundColor(.white).padding()
                }
                .accessibilityLabel("保存图片")
            }
            if let toast = saveToast {
                Text(toast)
                    .font(.footnote).foregroundColor(.white)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(Color.black.opacity(0.7))
                    .clipShape(Capsule())
                    .padding(.top, 80)
                    .onAppear {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { saveToast = nil }
                    }
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

/// 会话内消息搜索面板：输入关键词 → 命中列表，点结果关闭并跳转高亮(对齐 web/微信)
private struct MessageSearchSheet: View {
    @ObservedObject var vm: ChatViewModel

    var body: some View {
        NavigationStack {
            Group {
                if vm.searching {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if vm.searchQuery.trimmingCharacters(in: .whitespaces).isEmpty {
                    Text("输入关键词搜索本会话消息").foregroundColor(.vxinTextSecondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if vm.searchResults.isEmpty {
                    Text("没有找到相关消息").foregroundColor(.vxinTextSecondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(vm.searchResults) { msg in
                        Button {
                            let id = msg.id
                            vm.searchActive = false
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { vm.jumpTo(id) }
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Text(msg.senderName.isEmpty ? "用户" : msg.senderName)
                                        .font(.caption).fontWeight(.medium).foregroundColor(.vxinGreen)
                                    Spacer()
                                    Text(formatChatTime(msg.createdAt)).font(.caption2).foregroundColor(.vxinTextSecondary)
                                }
                                Text(preview(msg)).font(.subheadline).lineLimit(2).foregroundColor(.primary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                    .listStyle(.plain)
                }
            }
            .searchable(text: Binding(get: { vm.searchQuery }, set: { vm.onSearchQueryChange($0) }), prompt: "搜索聊天记录")
            .navigationTitle("搜索聊天记录").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("取消") { vm.searchActive = false } } }
        }
    }

    private func preview(_ m: Message) -> String {
        switch m.type {
        case "text": return m.content
        case "image": return "[图片]"
        case "voice": return "[语音]"
        case "video": return "[视频]"
        case "file": return "[文件] \(m.content)"
        case "red_packet": return "[红包]"
        case "transfer": return "[转账]"
        case "sticker": return "[表情]"
        default: return m.content.isEmpty ? "[消息]" : m.content
        }
    }
}
