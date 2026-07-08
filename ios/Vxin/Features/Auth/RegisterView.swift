import SwiftUI

struct RegisterView: View {
    @EnvironmentObject private var session: SessionStore
    @StateObject private var vm = AuthViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Spacer()

            Text("注册账号")
                .font(.title.bold())
                .foregroundColor(.vxinGreen)
                .padding(.bottom, 16)

            TextField("昵称", text: $vm.username)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("register-username-input")
            TextField("手机号", text: $vm.phone)
                .keyboardType(.phonePad)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("register-phone-input")
            PasswordField(placeholder: "密码（≥8位，含字母和数字）", text: $vm.password,
                          textContentType: .newPassword,
                          accessibilityId: "register-password-input")
            if vm.inviteRequired {
                TextField("邀请码（6位数字）", text: $vm.inviteCode)
                    .keyboardType(.numberPad)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("register-invite-input")
            }

            if let error = vm.error {
                Text(error)
                    .font(.footnote)
                    .foregroundColor(.vxinError)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button(action: vm.register) {
                ZStack {
                    if vm.loading { ProgressView().tint(.white) }
                    else { Text("注册并登录").bold() }
                }
                .frame(maxWidth: .infinity, minHeight: 48)
            }
            .background(vm.canRegister ? Color.vxinGreen : Color.vxinGreen.opacity(0.4))
            .foregroundColor(.white)
            .cornerRadius(8)
            .disabled(!vm.canRegister)
            .padding(.top, 8)
            .accessibilityIdentifier("register-submit-btn")

            Spacer()
        }
        .padding(.horizontal, 32)
        .navigationTitle("注册")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.loadConfig() }
        .onChange(of: vm.authedUser) { user in
            if let user { session.onAuthenticated(user) }
        }
    }
}
