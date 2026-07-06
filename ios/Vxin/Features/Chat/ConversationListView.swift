import SwiftUI

struct ConversationListView: View {
    @StateObject private var vm: ConversationListViewModel
    @State private var path = NavigationPath()
    @State private var clearTarget: Conversation?
    private let myId: String

    init(myId: String) {
        self.myId = myId
        _vm = StateObject(wrappedValue: ConversationListViewModel(myId: myId))
    }

    var body: some View {
        NavigationStack(path: $path) {
            content
                .navigationTitle("消息")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        VStack(spacing: 2) {
                            Text("消息").font(.headline)
                            Text(statusLabel)
                                .font(.caption2)
                                .foregroundColor(vm.socketStatus == .connected ? .vxinGreen : .vxinTextSecondary)
                        }
                    }
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button { path.append(SearchRoute.search) } label: { Image(systemName: "magnifyingglass") }
                            .accessibilityLabel("搜索")
                    }
                }
                .navigationDestination(for: Conversation.self) { conv in
                    ChatView(conversation: conv, myId: myId, onOpenGroupInfo: { path.append(GroupRoute.info(conv.id)) })
                }
                .navigationDestination(for: SearchRoute.self) { _ in
                    SearchView(onOpenResult: { r in
                        var conv = Conversation(id: r.conversationId, type: r.convType, name: r.convName)
                        // 私聊搜索结果带对端 id → 补进会话，使从搜索进的私聊也能拨号
                        if let uid = r.otherUserId, !uid.isEmpty {
                            conv.otherUser = Conversation.OtherUser(id: uid, username: r.convName)
                        }
                        path.append(conv)
                    })
                }
                .navigationDestination(for: GroupRoute.self) { route in
                    switch route {
                    case .info(let id):
                        GroupInfoView(conversationId: id, onInvite: { path.append(GroupRoute.invite(id)) }, onLeft: { path.removeLast(path.count) })
                    case .invite(let id):
                        InviteMembersView(conversationId: id, onDone: { if !path.isEmpty { path.removeLast() } })
                    }
                }
                // 点推送通知打开会话：优先用已加载会话(含 type/name)，否则用最小 Conversation(id:)，
                // ChatView 打开后会自行拉历史/资料补全。MainTabView 已负责切回消息 Tab。
                .onReceive(NotificationCenter.default.publisher(for: .vxinOpenConversation)) { note in
                    guard let id = note.userInfo?["conversationId"] as? String, !id.isEmpty else { return }
                    let conv = vm.conversations.first(where: { $0.id == id }) ?? Conversation(id: id)
                    path = NavigationPath()   // 从根重置，避免叠在已有导航栈上
                    path.append(conv)
                }
        }
    }

    @ViewBuilder private var content: some View {
        if vm.loading && vm.conversations.isEmpty {
            ProgressView()
        } else if let error = vm.error, vm.conversations.isEmpty {
            Text(error).foregroundColor(.vxinError)
        } else if vm.conversations.isEmpty {
            Text("暂无会话").foregroundColor(.vxinTextSecondary)
        } else {
            List(vm.conversations) { conv in
                NavigationLink(value: conv) {
                    ConversationRow(conversation: conv)
                }
                .accessibilityIdentifier("conv-item-\(conv.id)")
                .listRowBackground(conv.pinned == 1 ? Color.gray.opacity(0.08) : Color.clear)
                .contextMenu {
                    Button(conv.pinned == 1 ? "取消置顶" : "置顶") { vm.togglePin(conv) }
                    Button(conv.muted == 1 ? "取消免打扰" : "消息免打扰") { vm.toggleMute(conv) }
                    Button("清空聊天记录", role: .destructive) { clearTarget = conv }
                }
            }
            .listStyle(.plain)
            .refreshable { await vm.refresh() }
            .alert("清空聊天记录", isPresented: .constant(clearTarget != nil)) {
                Button("取消", role: .cancel) { clearTarget = nil }
                Button("清空", role: .destructive) { if let c = clearTarget { vm.clearMessages(c) }; clearTarget = nil }
            } message: {
                Text("确认清空与「\(clearTarget?.name ?? "该会话")」的聊天记录？此操作不可恢复。")
            }
        }
    }

    private var statusLabel: String {
        switch vm.socketStatus {
        case .connected: return "已连接"
        case .connecting: return "连接中…"
        case .disconnected: return "未连接"
        }
    }
}

private struct ConversationRow: View {
    let conversation: Conversation

    var body: some View {
        HStack(spacing: 12) {
            InitialAvatar(name: conversation.name.isEmpty ? "?" : conversation.name, size: 48)
            VStack(alignment: .leading, spacing: 3) {
                Text(conversation.name.isEmpty ? "未命名会话" : conversation.name)
                    .font(.body)
                    .lineLimit(1)
                    .accessibilityIdentifier("conv-item-name")
                HStack(spacing: 4) {
                    if conversation.hasMention {
                        // 有未读@我：绿色小标，读后随刷新消失
                        Text("[@我]")
                            .font(.caption2).bold()
                            .foregroundColor(.vxinGreen)
                            .accessibilityIdentifier("conv-item-mention")
                    }
                    Text(previewText)
                        .font(.subheadline)
                        .foregroundColor(.vxinTextSecondary)
                        .lineLimit(1)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(formatChatTime(conversation.lastTime))
                    .font(.caption2)
                    .foregroundColor(.vxinTextSecondary)
                if conversation.muted == 1 {
                    Image(systemName: "bell.slash.fill").font(.caption2).foregroundColor(.vxinTextSecondary)
                } else if conversation.unreadCount > 0 {
                    Text(conversation.unreadCount > 99 ? "99+" : "\(conversation.unreadCount)")
                        .font(.caption2)
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.vxinError)
                        .clipShape(Capsule())
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var previewText: String {
        switch conversation.lastMessageType {
        case nil, "text": return conversation.lastMessage ?? ""
        case "image": return "[图片]"
        case "voice": return "[语音]"
        case "video": return "[视频]"
        case "file": return "[文件]"
        case "red_packet": return "[红包]"
        case "sticker": return "[表情]"
        case "nudge": return "[拍一拍]"
        case "contact_card", "contact": return "[名片]"
        default: return conversation.lastMessage ?? ""
        }
    }
}
