import SwiftUI

/// 找回密码：手机号 + 邀请码 + 新密码。与 web ForgotPassword.jsx / Android ForgotPasswordScreen 对齐。
struct ForgotPasswordView: View {
    @StateObject private var vm = AuthViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Spacer()

            Text("找回密码")
                .font(.title.bold())
                .foregroundColor(.vxinGreen)
                .padding(.bottom, 16)

            TextField("手机号", text: $vm.phone)
                .keyboardType(.phonePad)
                .textFieldStyle(.roundedBorder)
            TextField("邀请码（6位数字）", text: $vm.inviteCode)
                .keyboardType(.numberPad)
                .textFieldStyle(.roundedBorder)
            PasswordField(placeholder: "新密码（≥8位，含字母和数字）", text: $vm.resetNewPassword,
                          textContentType: .newPassword)

            if let error = vm.error {
                Text(error)
                    .font(.footnote)
                    .foregroundColor(.vxinError)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if vm.resetDone {
                Text("✓ 密码已重置，请用新密码登录")
                    .font(.footnote)
                    .foregroundColor(.vxinGreen)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button(action: vm.resetPassword) {
                ZStack {
                    if vm.loading { ProgressView().tint(.white) }
                    else { Text("重置密码").bold() }
                }
                .frame(maxWidth: .infinity, minHeight: 48)
            }
            .background(vm.canReset ? Color.vxinGreen : Color.vxinGreen.opacity(0.4))
            .foregroundColor(.white)
            .cornerRadius(8)
            .disabled(!vm.canReset)
            .padding(.top, 8)

            Spacer()
        }
        .padding(.horizontal, 32)
        .navigationTitle("找回密码")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: vm.resetDone) { done in
            if done { DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { dismiss() } }
        }
    }
}
