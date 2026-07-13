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
            Section {
                Button(action: onRequests) {
                    HStack {
                        Text("新的朋友").foregroundColor(.primary)
                        Spacer()
                        if vm.requestCount > 0 {
                            Text("\(vm.requestCount)")
                                .font(.caption2).foregroundColor(.white)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Color.vxinError).clipShape(Capsule())
                        }
                        Image(systemName: "chevron.right").foregroundColor(.vxinTextSecondary).font(.caption)
                    }
                }
                Button(action: onOpenLabels) {
                    HStack {
                        Text("好友标签").foregroundColor(.primary)
                        Spacer()
                        Image(systemName: "chevron.right").foregroundColor(.vxinTextSecondary).font(.caption)
                    }
                }
                Button(action: onOpenBlocked) {
                    HStack {
                        Text("黑名单").foregroundColor(.primary)
                        Spacer()
                        Image(systemName: "chevron.right").foregroundColor(.vxinTextSecondary).font(.caption)
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
                                        Circle().fill(.green).frame(width: 12, height: 12)
                                            .overlay(Circle().stroke(.white, lineWidth: 2))
                                    }
                                }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(contact.displayName.isEmpty ? "未命名" : contact.displayName).foregroundColor(.primary)
                                if !contact.bio.isEmpty {
                                    Text(contact.bio).font(.caption).foregroundColor(.vxinTextSecondary).lineLimit(1)
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
        }
        .listStyle(.plain)
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
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                HStack {
                    Button(action: onCreateGroup) { Image(systemName: "person.3") }
                        .accessibilityLabel("发起群聊")
                    Button(action: onAddFriend) { Image(systemName: "plus") }
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
