import SwiftUI
import UIKit
import PhotosUI
import Kingfisher

struct ProfileView: View {
    @EnvironmentObject private var session: SessionStore

    @State private var username = ""
    @State private var bio = ""
    @State private var saving = false
    @State private var uploadingAvatar = false
    @State private var message: String?
    @State private var photoItem: PhotosPickerItem?
    @State private var showAddAccount = false
    @State private var invite: InviteInfo?
    @State private var inviteCopied = false

    private let repo = ProfileRepository.shared

    var body: some View {
        Form {
            // Hero 横幅：极光靛渐变（对齐 Web/Android pf-hero），边到边
            Section {
                VStack(spacing: 10) {
                    avatarView
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Text("更换头像").font(.footnote).foregroundColor(.white.opacity(0.9))
                    }
                    if uploadingAvatar { ProgressView().tint(.white) }
                    if let user = session.currentUser {
                        Text(user.username.isEmpty ? "未设置昵称" : user.username)
                            .font(.title3.bold()).foregroundColor(.white)
                        if !user.wechatId.isEmpty {
                            Text("v信号: \(user.wechatId)")
                                .font(.footnote).foregroundColor(.white.opacity(0.85))
                        }
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
                .background(
                    LinearGradient(colors: [.vxinBrandLight, .vxinBrand, .vxinTeal],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                )
                .listRowInsets(EdgeInsets())
            }

            Section {
                // 我的二维码入口（对齐微信 + 安卓）
                NavigationLink {
                    MyQRCodeView()
                } label: {
                    HStack {
                        Image(systemName: "qrcode").foregroundColor(.vxinBrand)
                        Text("我的二维码")
                    }
                }
                .accessibilityIdentifier("profile-my-qr")
            }

            Section("资料") {
                TextField("昵称", text: $username)
                TextField("个性签名", text: $bio, axis: .vertical).lineLimit(1...3)
                Button(action: saveProfile) {
                    if saving { ProgressView() } else { Text("保存资料").foregroundColor(.vxinGreen) }
                }
                .disabled(saving || username.isEmpty)
            }

            // 朋友圈 / 收藏 已是底部 Tab，移除「我」页内重复入口（四端一致）

            if let inv = invite {
                Section("邀请好友") {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("我的邀请码：\(inv.code.isEmpty ? "—" : inv.code)")
                                .foregroundColor(.vxinGreen)
                            Text("已成功邀请 \(inv.invitedCount) 人")
                                .font(.footnote).foregroundColor(.vxinTextSecondary)
                        }
                        Spacer()
                        Button(inviteCopied ? "已复制" : "复制") {
                            guard !inv.code.isEmpty else { return }
                            UIPasteboard.general.string = inv.code
                            inviteCopied = true
                        }
                        .buttonStyle(.borderless)
                        .foregroundColor(.vxinGreen)
                    }
                    ForEach(inv.invitees.prefix(20)) { u in
                        HStack {
                            InitialAvatar(name: u.username.isEmpty ? "?" : u.username, size: 28)
                            Text(u.username.isEmpty ? "未命名" : u.username)
                        }
                    }
                }
            }

            Section {
                NavigationLink { WalletView() } label: {
                    Label("我的钱包", systemImage: "creditcard")
                }
                NavigationLink { CallHistoryView() } label: {
                    Label("通话记录", systemImage: "phone")
                }
                NavigationLink { SessionsView() } label: {
                    Label("登录设备管理", systemImage: "desktopcomputer")
                }
            }

            Section("设置") {
                NavigationLink("隐私与安全") { PrivacySecurityView() }
                NavigationLink("外观") { AppearanceSettingsView() }
                NavigationLink("通知") { NotificationSettingsView() }
            }

            Section("账号") {
                ForEach(session.accounts()) { acc in
                    HStack {
                        InitialAvatar(name: acc.username.isEmpty ? "?" : acc.username, size: 32)
                        Text(acc.username.isEmpty ? "未命名" : acc.username)
                        Spacer()
                        if acc.id == session.activeAccountId {
                            Text("当前").font(.caption).foregroundColor(.vxinGreen)
                        } else {
                            Button("移除", role: .destructive) { session.removeAccount(acc.id) }
                                .buttonStyle(.borderless)
                        }
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { if acc.id != session.activeAccountId { session.switchAccount(acc.id) } }
                }
                Button("添加账号") { showAddAccount = true }
            }

            if let message { Section { Text(message).foregroundColor(.vxinGreen).font(.footnote) } }

            Section {
                Button("退出登录", role: .destructive) { Task { await session.logout() } }
            }
        }
        .navigationTitle("我")
        .sheet(isPresented: $showAddAccount) {
            NavigationStack { LoginView() }
        }
        .onAppear {
            if username.isEmpty { username = session.currentUser?.username ?? "" }
            if bio.isEmpty { bio = session.currentUser?.bio ?? "" }
            if invite == nil { Task { invite = try? await repo.myInvite() } }
        }
        .onChange(of: photoItem) { item in handlePhoto(item) }
    }

    @ViewBuilder private var avatarView: some View {
        let user = session.currentUser
        PhotosPicker(selection: $photoItem, matching: .images) {
            if let avatar = user?.avatar, !avatar.isEmpty, let src = MediaUrlResolver.kfSource(raw: avatar) {
                KFImage(source: src)
                    .resizable().scaledToFill()
                    .frame(width: 80, height: 80).clipShape(Circle())
            } else {
                InitialAvatar(name: user?.username ?? "?", size: 80)
            }
        }
        .accessibilityLabel("更换头像")
    }

    private func saveProfile() {
        saving = true; message = nil
        Task {
            do {
                let user = try await repo.updateProfile(username: username.trimmingCharacters(in: .whitespaces), bio: bio)
                session.updateCurrentUser(user)
                message = "已保存"
            } catch {
                message = (error as? LocalizedError)?.errorDescription ?? "保存失败"
            }
            saving = false
        }
    }

    private func handlePhoto(_ item: PhotosPickerItem?) {
        guard let item else { return }
        uploadingAvatar = true; message = nil
        Task {
            defer { uploadingAvatar = false; photoItem = nil }
            guard let data = try? await item.loadTransferable(type: Data.self) else { return }
            let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.85) ?? data
            do {
                let url = try await repo.uploadAvatar(data: jpeg, fileName: "avatar.jpg")
                if let user = session.currentUser {
                    var updated = user
                    updated.avatar = url
                    session.updateCurrentUser(updated)
                }
                message = "头像已更新"
            } catch {
                message = (error as? LocalizedError)?.errorDescription ?? "头像上传失败"
            }
        }
    }

}

private struct LabeledRow: View {
    let label: String
    let value: String
    init(_ label: String, _ value: String) { self.label = label; self.value = value }
    var body: some View {
        HStack { Text(label); Spacer(); Text(value).foregroundColor(.vxinTextSecondary) }
    }
}
