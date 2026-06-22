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
    @State private var showAddAccount = false

    private let repo = ProfileRepository.shared

    var body: some View {
        Form {
            Section {
                HStack {
                    Spacer()
                    VStack(spacing: 8) {
                        avatarView
                        PhotosPicker(selection: $photoItem, matching: .images) {
                            Text("更换头像").font(.footnote).foregroundColor(.vxinGreen)
                        }
                        if uploadingAvatar { ProgressView() }
                    }
                    Spacer()
                }
                if let user = session.currentUser {
                    if !user.wechatId.isEmpty { LabeledRow("v信号", user.wechatId) }
                    if !user.phone.isEmpty { LabeledRow("手机号", user.phone) }
                }
            }

            Section("资料") {
                TextField("昵称", text: $username)
                TextField("个性签名", text: $bio, axis: .vertical).lineLimit(1...3)
                Button(action: saveProfile) {
                    if saving { ProgressView() } else { Text("保存资料").foregroundColor(.vxinGreen) }
                }
                .disabled(saving || username.isEmpty)
            }

            Section {
                NavigationLink("朋友圈") { MomentsView() }
                NavigationLink("收藏") { FavoritesView() }
            }

            Section("设置") {
                NavigationLink("设备管理") { Text("设备管理").navigationTitle("设备管理") }
                NavigationLink("隐私与安全") { Text("隐私与安全").navigationTitle("隐私与安全") }
                NavigationLink("外观") { Text("外观").navigationTitle("外观") }
                NavigationLink("通知") { Text("通知").navigationTitle("通知") }
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
                Button("修改密码") { showPasswordSheet = true }
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
        }
        .onChange(of: photoItem) { item in handlePhoto(item) }
        .sheet(isPresented: $showPasswordSheet) {
            ChangePasswordSheet { old, new in
                await changePassword(old: old, new: new)
            }
        }
    }

    @ViewBuilder private var avatarView: some View {
        let user = session.currentUser
        PhotosPicker(selection: $photoItem, matching: .images) {
            if let avatar = user?.avatar, !avatar.isEmpty, let url = MediaUrlResolver.resolve(avatar) {
                KFImage(URL(string: url))
                    .resizable().scaledToFill()
                    .frame(width: 80, height: 80).clipShape(Circle())
            } else {
                InitialAvatar(name: user?.username ?? "?", size: 80)
            }
        }
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
            try await repo.changePassword(oldPassword: old, newPassword: new)
            message = "密码已修改"
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? "修改失败"
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
                SecureField("新密码（≥6位）", text: $new1)
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
        if new1.count < 6 { return "新密码至少6位" }
        if new1 != new2 { return "两次新密码不一致" }
        return nil
    }
}
