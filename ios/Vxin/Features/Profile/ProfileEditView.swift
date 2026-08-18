import SwiftUI
import UIKit
import PhotosUI
import Kingfisher

/// 个人资料页：真实字段绑定（User 模型只有 username/phone/avatar/bio/wechatId/coverPhoto）。
/// 参考图中的性别/生日/邮箱/职业/公司/所在地 当前数据模型不存在，不在此臆造。
struct ProfileEditView: View {
    @EnvironmentObject private var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var username = ""
    @State private var bio = ""
    @State private var saving = false
    @State private var uploadingAvatar = false
    @State private var message: String?
    @State private var photoItem: PhotosPickerItem?
    private let repo = ProfileRepository.shared

    private enum Tok {
        static let green = Color.vxinBrand
        static let secondary = Color(UIColor.secondaryLabel)
        static let avatarSize: CGFloat = 80
    }

    var body: some View {
        Form {
            Section {
                HStack {
                    Spacer()
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        avatarView
                            .overlay(alignment: .bottomTrailing) {
                                Image(systemName: "camera.fill")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(.white)
                                    .padding(5)
                                    .background(Tok.green)
                                    .clipShape(Circle())
                                    .offset(x: 2, y: 2)
                            }
                    }
                    .accessibilityLabel("更换头像")
                    Spacer()
                }
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
            }

            Section {
                HStack {
                    Text("昵称")
                    Spacer()
                    TextField("请输入昵称", text: $username)
                        .multilineTextAlignment(.trailing)
                        .accessibilityIdentifier("edit-username-input")
                }
                HStack {
                    Text("投聊号")
                    Spacer()
                    // 后端无「修改投聊号」接口，只读展示
                    Text(session.currentUser?.wechatId.isEmpty == false ? session.currentUser!.wechatId : "-")
                        .foregroundColor(Tok.secondary)
                }
                HStack {
                    Text("个性签名")
                    Spacer()
                    TextField("请输入个性签名", text: $bio)
                        .multilineTextAlignment(.trailing)
                        .accessibilityIdentifier("edit-bio-input")
                }
            }

            Section {
                NavigationLink(destination: ChangePhoneView(
                    currentPhone: session.currentUser?.phone ?? "",
                    onChanged: { p in
                        if var u = session.currentUser { u.phone = p; session.updateCurrentUser(u) }
                    })) {
                    HStack {
                        Text("手机号")
                        Spacer()
                        Text(maskedPhone(session.currentUser?.phone ?? "")).foregroundColor(Tok.secondary)
                    }
                }
                NavigationLink(destination: MyQRCodeView()) {
                    Text("我的二维码")
                }
            }

            Section {
                Button {
                    saveProfile()
                } label: {
                    if saving {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Text("保存")
                            .foregroundColor(Tok.green)
                            .frame(maxWidth: .infinity)
                    }
                }
                .disabled(saving || username.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityIdentifier("edit-save-btn")
            }
        }
        .navigationTitle("个人资料")
        .navigationBarTitleDisplayMode(.inline)
        .toast($message)
        .onAppear {
            if username.isEmpty { username = session.currentUser?.username ?? "" }
            if bio.isEmpty { bio = session.currentUser?.bio ?? "" }
        }
        .onChange(of: photoItem) { item in handlePhoto(item) }
        .overlay {
            if uploadingAvatar {
                ProgressView("上传头像中…")
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private func maskedPhone(_ phone: String) -> String {
        guard phone.count >= 7 else { return phone.isEmpty ? "未绑定" : phone }
        return "\(phone.prefix(3))****\(phone.suffix(4))"
    }

    @ViewBuilder private var avatarView: some View {
        let user = session.currentUser
        if let avatar = user?.avatar, !avatar.isEmpty,
           let src = MediaUrlResolver.kfSource(raw: avatar) {
            KFImage(source: src)
                .resizable().scaledToFill()
                .frame(width: Tok.avatarSize, height: Tok.avatarSize)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        } else {
            InitialAvatar(name: user?.username ?? "?", size: Tok.avatarSize)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private func saveProfile() {
        saving = true; message = nil
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        Task {
            do {
                var user = try await repo.updateProfile(
                    username: username.trimmingCharacters(in: .whitespaces), bio: bio
                )
                if user.phone.isEmpty, let phone = session.currentUser?.phone { user.phone = phone }
                session.updateCurrentUser(user)
                message = "已保存"
                await MainActor.run {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { dismiss() }
                }
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
                    var updated = user; updated.avatar = url
                    session.updateCurrentUser(updated)
                }
                message = "头像已更新"
            } catch {
                message = (error as? LocalizedError)?.errorDescription ?? "头像上传失败"
            }
        }
    }
}
