import SwiftUI

/// 找回密码：与 Web/Android 对齐（P1-01）——原"手机号+6位邀请码"自助重置流程存在账号接管
/// 风险（邀请码空间小、易被枚举），后端 auth.service.js resetPassword() 已硬编码禁用，无论提交
/// 什么参数一律返回"密码重置功能暂不可用"。三端此前不一致：Web 已改成纯提示页，Android/iOS
/// 却还留着完整表单——用户填完提交必然收到统一拒绝错误，是死 UI。这里同步收紧。
struct ForgotPasswordView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Spacer()

            ZStack {
                RoundedRectangle(cornerRadius: VxinRadius.lg, style: .continuous)
                    .fill(LinearGradient(colors: [.vxinBrandLight, .vxinBrandDark],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 64, height: 64)
                    .shadow(color: .vxinBrand.opacity(0.4), radius: 10, y: 5)
                Image(systemName: "lock.rotation")
                    .font(.system(size: 26)).foregroundColor(.white)
            }
            .padding(.bottom, 4)
            Text("忘记密码")
                .font(.title.bold())
                .foregroundColor(.primary)
            Text("密码重置服务暂时不可用")
                .font(.subheadline)
                .foregroundColor(.vxinTextSecondary)
                .padding(.bottom, 16)

            Text("为保护账号安全，当前不支持在线重置密码。\n请联系管理员协助处理。")
                .font(.body)
                .foregroundColor(.primary)
                .multilineTextAlignment(.center)

            Button("返回登录") { dismiss() }
                .font(.subheadline)
                .foregroundColor(.vxinTextSecondary)
                .padding(.top, 16)

            Spacer()
        }
        .padding(.horizontal, 32)
        .navigationTitle("忘记密码")
        .navigationBarTitleDisplayMode(.inline)
    }
}
