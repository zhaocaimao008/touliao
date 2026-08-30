import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var session: SessionStore
    @StateObject private var vm = AuthViewModel()
    // 添加账号入口专用：传入后显示「取消」按钮关闭弹层；普通登录入口不传，无影响
    var onCancel: (() -> Void)? = nil
    @State private var showServerConfig = false

    var body: some View {
        VStack(spacing: 16) {
            if let onCancel {
                HStack {
                    Button(action: onCancel) {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.left")
                            Text("返回")
                        }
                    }
                    .foregroundColor(.vxinBrand)
                    Spacer()
                }
                .padding(.top, 8)
            }
            Spacer()

            // 品牌 Logo 徽章：极光靛渐变圆角方 + 对话图标（对齐 Web/Android 登录页）
            ZStack {
                RoundedRectangle(cornerRadius: VxinRadius.xl, style: .continuous)
                    .fill(LinearGradient(colors: [.vxinBrandLight, .vxinBrandDark],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 72, height: 72)
                    .shadow(color: .vxinBrand.opacity(0.4), radius: 12, y: 6)
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 30))
                    .foregroundColor(.white)
            }
            Text("投聊")
                .font(.system(size: VxinFontSize.displayLg, weight: .bold))
                .foregroundColor(.primary)
            Text("安全 · 私密 · 畅聊")
                .font(.subheadline)
                .foregroundColor(.vxinTextSecondary)
                .padding(.bottom, 24)

            TextField("手机号", text: $vm.phone)
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("login-phone-input")

            PasswordField(placeholder: "密码", text: $vm.password,
                          accessibilityId: "login-password-input")

            if vm.captchaRequired {
                HStack(spacing: 12) {
                    TextField("请输入图中字符", text: $vm.captchaText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("login-captcha-input")
                    Button {
                        Task { await vm.loadCaptcha() }
                    } label: {
                        CaptchaImageView(svgDataUrl: vm.captchaSvg)
                            .frame(width: 100, height: 44)
                            .clipShape(RoundedRectangle(cornerRadius: VxinRadius.md, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: VxinRadius.md, style: .continuous)
                                    .stroke(Color.vxinTextSecondary.opacity(0.2), lineWidth: 1)
                            )
                    }
                    .accessibilityIdentifier("login-captcha-refresh")
                    .accessibilityLabel("验证码，点击换一张")
                }
            }

            if let error = vm.error {
                Text(error)
                    .font(.footnote)
                    .foregroundColor(.vxinError)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("auth-error-text")
            }

            Button(action: vm.login) {
                ZStack {
                    if vm.loading { ProgressView().tint(.white) }
                    else { Text("登录").bold() }
                }
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(
                    Group {
                        if vm.canLogin {
                            LinearGradient(colors: [.vxinBrandLight, .vxinBrandDark],
                                           startPoint: .leading, endPoint: .trailing)
                        } else {
                            Color.vxinTextSecondary.opacity(0.4)
                        }
                    }
                )
                .foregroundColor(.white)
                .clipShape(RoundedRectangle(cornerRadius: VxinRadius.pill, style: .continuous))
                .shadow(color: vm.canLogin ? .vxinBrand.opacity(0.35) : .clear, radius: 8, y: 4)
            }
            .disabled(!vm.canLogin)
            .padding(.top, 8)
            .accessibilityIdentifier("login-submit-btn")

            HStack {
                NavigationLink("注册账号") { RegisterView() }
                    .foregroundColor(.vxinGreen)
                Spacer()
                NavigationLink("忘记密码") { ForgotPasswordView() }
                    .foregroundColor(.vxinTextSecondary)
            }

            Button(showServerConfig ? "收起" : "切换服务器") { showServerConfig.toggle() }
                .font(.caption)
                .foregroundColor(.vxinTextSecondary)

            if showServerConfig {
                TextField("服务器地址", text: $vm.serverURL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .textFieldStyle(.roundedBorder)
                Button("保存") { vm.saveServerURL(); showServerConfig = false }
                    .foregroundColor(.vxinGreen)
            }

            Spacer()
        }
        .padding(.horizontal, 32)
        .task { await vm.loadConfig() }
        .onChange(of: vm.authedUser) { user in
            if let user { session.onAuthenticated(user) }
        }
    }
}
