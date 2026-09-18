import SwiftUI

/// 通讯录相关导航路由（值驱动 NavigationStack）
enum ContactRoute: Hashable {
    case contacts
    case addFriend
    case requests
    case createGroup
    case blocked
    case labels
}

struct ContactsView: View {
    var onStartChat: (Conversation) -> Void
    var onAddFriend: () -> Void
    var onRequests: () -> Void
    var onCreateGroup: () -> Void
    var onOpenBlocked: () -> Void = {}
    var onOpenLabels: () -> Void = {}

    @StateObject private var vm = ContactsViewModel()
    @State private var remarkTarget: Contact?
    @State private var remarkText = ""
    @State private var deleteTarget: Contact?
    @State private var blockTarget: Contact?

    var body: some View {
        List {
            Group {
            Section {
                Button(action: onRequests) {
                    HStack {
                        Text("新的朋友").foregroundColor(.vxinText)
                        Spacer()
                        if vm.requestCount > 0 {
                            Text("\(vm.requestCount)")
                                .touliaoFont(12).foregroundColor(.vxinOnPrimary)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Color.vxinError).clipShape(Capsule())
                        }
                        TouliaoIcon(systemName: "chevron.right").foregroundColor(.vxinTextSecondary).touliaoFont(12)
                    }
                }
                Button(action: onOpenLabels) {
                    HStack {
                        Text("好友标签").foregroundColor(.vxinText)
                        Spacer()
                        TouliaoIcon(systemName: "chevron.right").foregroundColor(.vxinTextSecondary).touliaoFont(12)
                    }
                }
                Button(action: onOpenBlocked) {
                    HStack {
                        Text("黑名单").foregroundColor(.vxinText)
                        Spacer()
                        TouliaoIcon(systemName: "chevron.right").foregroundColor(.vxinTextSecondary).touliaoFont(12)
                    }
                }
                Button(action: { vm.showAiBots.toggle() }) {
                    HStack {
                        Text(vm.showAiBots ? "AI 助手 (\\(vm.aiBots.count))" : "AI 助手").foregroundColor(.vxinText)
                        Spacer()
                        TouliaoIcon(systemName: vm.showAiBots ? "chevron.up" : "chevron.right")
                            .foregroundColor(.vxinTextSecondary).touliaoFont(12)
                    }
                }
                if vm.showAiBots {
                    if vm.aiBots.isEmpty {
                        Text("暂无 AI 助手").touliaoFont(14).foregroundColor(.vxinTextSecondary)
                    } else {
                        ForEach(vm.aiBots) { bot in
                            Button { Task { if let conv = await vm.startAiChat(bot) { onStartChat(conv) } } } label: {
                                HStack(spacing: 12) {
                                    InitialAvatar(name: bot.name.isEmpty ? "?" : bot.name, size: 40)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(bot.name.isEmpty ? bot.username : bot.name).foregroundColor(.vxinText)
                                        if !bot.description.isEmpty {
                                            Text(bot.description).touliaoFont(12).foregroundColor(.vxinTextSecondary).lineLimit(1)
                                        }
                                    }
                                    Spacer()
                                    TouliaoIcon(systemName: "chevron.right").foregroundColor(.vxinTextSecondary).touliaoFont(12)
                                }
                            }
                        }
                    }
                }
            }

            Section("联系人") {
                if vm.contacts.isEmpty && !vm.loading {
                    Text("还没有联系人").foregroundColor(.vxinTextSecondary)
                }
                ForEach(vm.contacts) { contact in
                    Button { Task { if let conv = await vm.startPrivateChat(contact) { onStartChat(conv) } } } label: {
                        HStack(spacing: 12) {
                            InitialAvatar(name: contact.displayName.isEmpty ? "?" : contact.displayName, size: 44)
                                .overlay(alignment: .bottomTrailing) {
                                    if vm.onlineIds.contains(contact.id) {
                                        Circle().fill(Color.vxinOnline).frame(width: 12, height: 12)
                                            .overlay(Circle().stroke(.white, lineWidth: 2))
                                    }
                                }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(contact.displayName.isEmpty ? "未命名" : contact.displayName).foregroundColor(.vxinText)
                                if !contact.bio.isEmpty {
                                    Text(contact.bio).touliaoFont(12).foregroundColor(.vxinTextSecondary).lineLimit(1)
                                }
                                // 特权账户：离线时展示精确最后在线时间（后端仅对特权账户返回 lastOnlineAt）
                                if !vm.onlineIds.contains(contact.id),
                                   let ts = contact.lastOnlineAt, ts > 0 {
                                    Text(formatLastOnline(ts)).touliaoFont(12).foregroundColor(.vxinTextSecondary).lineLimit(1)
                                }
                            }
                            Spacer()
                        }
                    }
                    .contextMenu {
                        Button("设置备注") { remarkText = contact.remark ?? ""; remarkTarget = contact }
                        Button("加入黑名单", role: .destructive) { blockTarget = contact }
                        Button("删除好友", role: .destructive) { deleteTarget = contact }
                    }
                }
            }
            }.listRowBackground(Color.vxinSurface).listRowSeparatorTint(Color.vxinBorder)
        }
        .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.vxinSurface)
        .alert("设置备注", isPresented: .constant(remarkTarget != nil)) {
            TextField("留空恢复默认昵称", text: $remarkText)
            Button("取消", role: .cancel) { remarkTarget = nil }
            Button("确定") { if let c = remarkTarget { vm.setRemark(c, remark: remarkText) }; remarkTarget = nil }
        }
        .alert("删除好友", isPresented: .constant(deleteTarget != nil)) {
            Button("取消", role: .cancel) { deleteTarget = nil }
            Button("删除", role: .destructive) { if let c = deleteTarget { vm.deleteContact(c) }; deleteTarget = nil }
        } message: {
            Text("确认删除好友「\(deleteTarget?.displayName ?? "")」？将同时删除聊天记录。")
        }
        .alert("加入黑名单", isPresented: .constant(blockTarget != nil)) {
            Button("取消", role: .cancel) { blockTarget = nil }
            Button("加入", role: .destructive) { if let c = blockTarget { vm.block(c) }; blockTarget = nil }
        } message: {
            Text("加入黑名单后，将不再收到「\(blockTarget?.displayName ?? "")」的消息。")
        }
        .navigationTitle("通讯录")
        .navigationBarTitleDisplayMode(.inline)
        .touliaoPage()
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                HStack {
                    Button(action: onCreateGroup) { TouliaoIcon(systemName: "person.3") }
                        .accessibilityLabel("发起群聊")
                    Button(action: onAddFriend) { TouliaoIcon(systemName: "plus") }
                        .accessibilityLabel("添加好友")
                }
            }
        }
        .overlay {
            if vm.loading && vm.contacts.isEmpty { ProgressView() }
        }
        .toast($vm.error)
        .task { await vm.refresh() }
    }
}

/// 特权账户：格式化好友最后在线时间（Unix 秒），精确到分钟。
func formatLastOnline(_ ts: Double) -> String {
    guard ts > 0 else { return "" }
    let date = Date(timeIntervalSince1970: ts)
    let now = Date()
    let diff = max(0, now.timeIntervalSince(date))
    let f = DateFormatter()
    f.dateFormat = "HH:mm"
    let time = f.string(from: date)
    if diff < 60 { return "刚刚在线" }
    if diff < 3600 { return "\(Int(diff / 60)) 分钟前在线" }
    let cal = Calendar.current
    if cal.isDateInToday(date) { return "今天 \(time)" }
    if cal.isDateInYesterday(date) { return "昨天 \(time)" }
    let df = DateFormatter()
    df.dateFormat = "M月d日 HH:mm"
    return df.string(from: date)
}
