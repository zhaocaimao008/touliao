import SwiftUI

/// 通讯录相关导航路由（值驱动 NavigationStack）
enum ContactRoute: Hashable {
    case contacts
    case addFriend
    case requests
    case createGroup
}

struct ContactsView: View {
    var onStartChat: (Conversation) -> Void
    var onAddFriend: () -> Void
    var onRequests: () -> Void
    var onCreateGroup: () -> Void

    @StateObject private var vm = ContactsViewModel()

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
            }

            Section("联系人") {
                if vm.contacts.isEmpty && !vm.loading {
                    Text("还没有联系人").foregroundColor(.vxinTextSecondary)
                }
                ForEach(vm.contacts) { contact in
                    Button { Task { if let conv = await vm.startPrivateChat(contact) { onStartChat(conv) } } } label: {
                        HStack(spacing: 12) {
                            InitialAvatar(name: contact.displayName.isEmpty ? "?" : contact.displayName, size: 44)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(contact.displayName.isEmpty ? "未命名" : contact.displayName).foregroundColor(.primary)
                                if !contact.bio.isEmpty {
                                    Text(contact.bio).font(.caption).foregroundColor(.vxinTextSecondary).lineLimit(1)
                                }
                            }
                            Spacer()
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle("通讯录")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                HStack {
                    Button(action: onCreateGroup) { Image(systemName: "person.3") }
                    Button(action: onAddFriend) { Image(systemName: "plus") }
                }
            }
        }
        .overlay {
            if vm.loading && vm.contacts.isEmpty { ProgressView() }
        }
        .task { await vm.refresh() }
    }
}
