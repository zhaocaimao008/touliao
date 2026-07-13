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
    @State private var showPasswordSheet = false
    @State private var showDeleteSheet = false
    @State private var showAddAccount = false
    @State private var changePwdAllowed = true   // 后台「自助修改密码」开关
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
                if changePwdAllowed {
                    Button("修改密码") { showPasswordSheet = true }
                }
                Button("退出登录", role: .destructive) { Task { await session.logout() } }
                Button("注销账号", role: .destructive) { showDeleteSheet = true }
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
            Task { changePwdAllowed = await ProfileRepository.shared.changePasswordAllowed() }
        }
        .onChange(of: photoItem) { item in handlePhoto(item) }
        .sheet(isPresented: $showPasswordSheet) {
            ChangePasswordSheet { old, new in
                await changePassword(old: old, new: new)
            }
        }
        .sheet(isPresented: $showDeleteSheet) {
            DeleteAccountSheet { password in
                await deleteAccount(password: password)
            }
        }
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

    private func changePassword(old: String, new: String) async {
        do {
            let token = try await repo.changePassword(oldPassword: old, newPassword: new)
            // 关键：旧 Bearer token 已被后端拉黑，立即用新 token 覆盖本地，否则下一请求 401 被登出
            if let token, !token.isEmpty { session.applyNewToken(token) }
            message = "密码已修改"
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "修改失败"
        }
    }

    private func deleteAccount(password: String) async {
        do {
            try await repo.deleteAccount(password: password)
            await session.deleteAccount()   // 清本地登录态 → 自动回登录页
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "注销失败"
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

private struct ChangePasswordSheet: View {
    var onConfirm: (String, String) async -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var old = ""
    @State private var new1 = ""
    @State private var new2 = ""
    @State private var error: String?
    @State private var submitting = false

    var body: some View {
        NavigationStack {
            Form {
                SecureField("当前密码", text: $old)
                SecureField("新密码（≥8位，含字母和数字）", text: $new1)
                SecureField("确认新密码", text: $new2)
                if let error { Text(error).foregroundColor(.vxinError).font(.footnote) }
            }
            .navigationTitle("修改密码")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("确定") {
                        error = validate()
                        guard error == nil else { return }
                        submitting = true
                        Task { await onConfirm(old, new1); submitting = false; dismiss() }
                    }.disabled(submitting)
                }
            }
        }
    }

    private func validate() -> String? {
        if old.isEmpty || new1.isEmpty { return "请填写完整" }
        // 与后端一致：≥8 位且同时含字母与数字，避免过前端却被后端 400
        let strong = new1.range(of: "^(?=.*[a-zA-Z])(?=.*\\d).{8,}$", options: .regularExpression) != nil
        if !strong { return "新密码至少8位且需包含字母和数字" }
        if new1 == old { return "新密码不能与当前密码相同" }
        if new1 != new2 { return "两次新密码不一致" }
        return nil
    }
}

private struct DeleteAccountSheet: View {
    var onConfirm: (String) async -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var password = ""
    @State private var error: String?
    @State private var submitting = false

    var body: some View {
        NavigationStack {
            Form {
                Section(footer: Text("注销后账号信息将被清除、无法登录，且此操作不可撤销。")) {
                    SecureField("请输入当前密码确认", text: $password)
                }
                if let error { Text(error).foregroundColor(.vxinError).font(.footnote) }
            }
            .navigationTitle("注销账号")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("确认注销", role: .destructive) {
                        guard !password.isEmpty else { error = "请输入密码"; return }
                        submitting = true
                        Task { await onConfirm(password); submitting = false; dismiss() }
                    }.disabled(submitting)
                }
            }
        }
    }
}
