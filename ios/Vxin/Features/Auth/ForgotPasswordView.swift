import SwiftUI

/// 找回密码：手机号 + 邀请码 + 新密码。与 web ForgotPassword.jsx / Android ForgotPasswordScreen 对齐。
struct ForgotPasswordView: View {
    @StateObject private var vm = AuthViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Spacer()

            // 品牌 Logo 徽章（与登录/注册页一致）
            ZStack {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(LinearGradient(colors: [.vxinBrandLight, .vxinBrandDark],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 64, height: 64)
                    .shadow(color: .vxinBrand.opacity(0.4), radius: 10, y: 5)
                Image(systemName: "lock.rotation")
                    .font(.system(size: 26)).foregroundColor(.white)
            }
            .padding(.bottom, 4)
            Text("找回密码")
                .font(.title.bold())
                .foregroundColor(.primary)
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

            VxinGradientButton(title: "重置密码", loading: vm.loading, enabled: vm.canReset,
                               action: vm.resetPassword)
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
