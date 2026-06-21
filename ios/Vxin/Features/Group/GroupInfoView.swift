import SwiftUI

/// 群相关导航路由（值驱动 NavigationStack）
enum GroupRoute: Hashable {
    case info(String)
    case invite(String)
}

struct GroupInfoView: View {
    let conversationId: String
    var onInvite: () -> Void
    var onLeft: () -> Void

    @StateObject private var vm: GroupInfoViewModel
    @State private var showRename = false
    @State private var renameText = ""
    @State private var kickTarget: GroupMember?
    @State private var showLeaveConfirm = false

    init(conversationId: String, onInvite: @escaping () -> Void, onLeft: @escaping () -> Void) {
        self.conversationId = conversationId
        self.onInvite = onInvite
        self.onLeft = onLeft
        _vm = StateObject(wrappedValue: GroupInfoViewModel(conversationId: conversationId))
    }

    var body: some View {
        Group {
            if vm.loading && vm.info == nil {
                ProgressView()
            } else if let info = vm.info {
                List {
                    Section {
                        Button {
                            renameText = info.name
                            if info.canManage { showRename = true }
                        } label: {
                            HStack {
                                Text("群名称").foregroundColor(.primary)
                                Spacer()
                                Text(info.name.isEmpty ? "未命名群聊" : info.name).foregroundColor(.vxinTextSecondary)
                                if info.canManage { Image(systemName: "chevron.right").font(.caption).foregroundColor(.vxinTextSecondary) }
                            }
                        }
                        .disabled(!info.canManage)
                    }

                    Section("群成员 (\(info.members.count))") {
                        Button(action: onInvite) {
                            HStack {
                                Image(systemName: "plus.circle.fill").foregroundColor(.vxinGreen)
                                Text("邀请成员").foregroundColor(.vxinGreen)
                            }
                        }
                        ForEach(info.members) { member in
                            HStack(spacing: 12) {
                                InitialAvatar(name: member.displayName.isEmpty ? "?" : member.displayName, size: 40)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(member.displayName.isEmpty ? "未命名" : member.displayName)
                                    if member.role != "member" {
                                        Text(member.role == "owner" ? "群主" : "管理员")
                                            .font(.caption).foregroundColor(.vxinGreen)
                                    }
                                }
                                Spacer()
                                if info.canManage && member.role != "owner" {
                                    Button("移除", role: .destructive) { kickTarget = member }
                                        .buttonStyle(.borderless)
                                }
                            }
                        }
                    }

                    Section {
                        Button("退出群聊", role: .destructive) { showLeaveConfirm = true }
                    }
                }
            } else {
                Text(vm.error ?? "加载失败").foregroundColor(.vxinError)
            }
        }
        .navigationTitle("群聊信息")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.refresh() }
        .onChange(of: vm.left) { left in if left { onLeft() } }
        .alert("修改群名称", isPresented: $showRename) {
            TextField("群名称", text: $renameText)
            Button("取消", role: .cancel) {}
            Button("确定") { vm.rename(renameText) }
        }
        .alert("移除成员", isPresented: .constant(kickTarget != nil)) {
            Button("取消", role: .cancel) { kickTarget = nil }
            Button("移除", role: .destructive) { if let m = kickTarget { vm.kick(m) }; kickTarget = nil }
        } message: {
            Text("确认将「\(kickTarget?.displayName ?? "")」移出群聊？")
        }
        .alert("退出群聊", isPresented: $showLeaveConfirm) {
            Button("取消", role: .cancel) {}
            Button("退出", role: .destructive) { vm.leave() }
        } message: {
            Text("退出后将不再接收该群消息。")
        }
    }
}
