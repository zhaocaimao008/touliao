import SwiftUI

struct RegisterView: View {
    @EnvironmentObject private var session: SessionStore
    @StateObject private var vm = AuthViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
        VStack(spacing: 16) {
            Spacer()

            // 品牌 Logo 徽章（与登录页一致）
            ZStack {
                RoundedRectangle(cornerRadius: VxinRadius.lg, style: .continuous)
                    .fill(Color.vxinBrand)
                    .frame(width: 64, height: 64)
                TouliaoIcon("chat", size: .lg).foregroundColor(.vxinOnPrimary)
            }
            .padding(.bottom, 4)
            Text("注册账号")
                .touliaoText(.title, weight: .bold)
                .foregroundColor(.vxinText)
                .padding(.bottom, 16)

            TouliaoField(title: "昵称") {
            TextField("昵称", text: $vm.username)
                .textFieldStyle(TouliaoTextFieldStyle())
                .accessibilityIdentifier("register-username-input")
            }
            TouliaoField(title: "手机号") {
            TextField("手机号", text: $vm.phone)
                .keyboardType(.phonePad)
                .textFieldStyle(TouliaoTextFieldStyle())
                .accessibilityIdentifier("register-phone-input")
            }
            TouliaoField(title: "密码") {
            PasswordField(placeholder: "密码（≥8位，含字母和数字）", text: $vm.password,
                          textContentType: .newPassword,
                          accessibilityId: "register-password-input")
            }
            if vm.inviteRequired {
                TextField("邀请码（6位数字）", text: $vm.inviteCode)
                    .keyboardType(.numberPad)
                    .textFieldStyle(TouliaoTextFieldStyle())
                    .accessibilityIdentifier("register-invite-input")
            }

            if let error = vm.error {
                Text(error)
                    .touliaoText(.secondary)
                    .foregroundColor(.vxinError)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }


            VxinGradientButton(title: "注册并登录", loading: vm.loading, enabled: vm.canRegister, action: vm.register)
            .padding(.top, 8)
            .accessibilityIdentifier("register-submit-btn")

            Spacer()
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .touliaoPage()
        .navigationTitle("注册")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.loadConfig() }
        .onChange(of: vm.authedUser) { user in
            if let user { session.onAuthenticated(user) }
        }
    }
}
