import SwiftUI
import PhotosUI
import Kingfisher

/// 群相关导航路由（值驱动 NavigationStack）
enum GroupRoute: Hashable {
    case info(String)
    case invite(String)
}

struct GroupInfoView: View {
    let conversationId: String
    var onInvite: () -> Void
    var onLeft: () -> Void

    @EnvironmentObject private var session: SessionStore
    @StateObject private var vm: GroupInfoViewModel
    @State private var showRename = false
    @State private var renameText = ""
    @State private var showNickname = false
    @State private var nicknameText = ""
    @State private var showAnnouncement = false
    @State private var announcementText = ""
    @State private var photoItem: PhotosPickerItem?
    @State private var kickTarget: GroupMember?
    @State private var showLeaveConfirm = false

    private var myId: String { session.currentUser?.id ?? "" }

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
                        // 群头像
                        HStack {
                            Text("群头像").foregroundColor(.primary)
                            Spacer()
                            groupAvatar(info)
                            if vm.uploadingAvatar { ProgressView() }
                            if info.canManage { Image(systemName: "chevron.right").font(.caption).foregroundColor(.vxinTextSecondary) }
                        }
                        .overlay {
                            if info.canManage {
                                PhotosPicker(selection: $photoItem, matching: .images) { Color.clear }
                            }
                        }

                        // 群名称
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

                        // 群公告
                        Button {
                            announcementText = info.announcement
                            if info.canManage { showAnnouncement = true }
                        } label: {
                            HStack(alignment: .top) {
                                Text("群公告").foregroundColor(.primary).frame(width: 64, alignment: .leading)
                                Text(info.announcement.isEmpty ? (info.canManage ? "点击设置群公告" : "暂无群公告") : info.announcement)
                                    .foregroundColor(.vxinTextSecondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                if info.canManage { Image(systemName: "chevron.right").font(.caption).foregroundColor(.vxinTextSecondary) }
                            }
                        }
                        .disabled(!info.canManage)

                        // 我的群昵称
                        Button {
                            nicknameText = info.myNickname(myId)
                            showNickname = true
                        } label: {
                            HStack {
                                Text("我的群昵称").foregroundColor(.primary)
                                Spacer()
                                Text(info.myNickname(myId).isEmpty ? "未设置" : info.myNickname(myId)).foregroundColor(.vxinTextSecondary)
                                Image(systemName: "chevron.right").font(.caption).foregroundColor(.vxinTextSecondary)
                            }
                        }
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
        .onChange(of: photoItem) { item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) { vm.setAvatar(data: data) }
                photoItem = nil
            }
        }
        .alert("修改群名称", isPresented: $showRename) {
            TextField("群名称", text: $renameText)
            Button("取消", role: .cancel) {}
            Button("确定") { vm.rename(renameText) }
        }
        .alert("我的群昵称", isPresented: $showNickname) {
            TextField("群昵称（留空恢复默认）", text: $nicknameText)
            Button("取消", role: .cancel) {}
            Button("确定") { vm.setNickname(nicknameText, myId: myId) }
        }
        .sheet(isPresented: $showAnnouncement) {
            NavigationStack {
                Form {
                    TextField("输入群公告", text: $announcementText, axis: .vertical).lineLimit(3...8)
                }
                .navigationTitle("群公告")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("取消") { showAnnouncement = false } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("保存") { vm.setAnnouncement(announcementText); showAnnouncement = false }
                    }
                }
            }
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

    @ViewBuilder private func groupAvatar(_ info: GroupInfo) -> some View {
        if !info.avatar.isEmpty, let url = MediaUrlResolver.resolve(info.avatar) {
            KFImage(URL(string: url))
                .resizable().scaledToFill()
                .frame(width: 40, height: 40).clipShape(Circle())
        } else {
            InitialAvatar(name: info.name.isEmpty ? "群" : info.name, size: 40)
        }
    }
}
