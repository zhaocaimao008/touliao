import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var session: SessionStore
    @StateObject private var vm = AuthViewModel()
    // 添加账号入口专用：传入后显示「取消」按钮关闭弹层；普通登录入口不传，无影响
    var onCancel: (() -> Void)? = nil
    @State private var showServerConfig = false

    var body: some View {
        ScrollView {
        VStack(spacing: 16) {
            if let onCancel {
                HStack {
                    Button(action: onCancel) {
                        HStack(spacing: 4) {
                            TouliaoIcon(systemName: "chevron.left")
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
                    .fill(Color.vxinBrand)
                    .frame(width: 72, height: 72)
                TouliaoIcon(systemName: "bubble.left.and.bubble.right.fill", size: 30)
                    .foregroundColor(.vxinOnPrimary)
            }
            Text("投聊")
                .touliaoFont(VxinFontSize.displayLg, weight: .bold)
                .foregroundColor(.vxinText)
            Text("安全 · 私密 · 畅聊")
                .touliaoFont(14)
                .foregroundColor(.vxinTextSecondary)
                .padding(.bottom, 24)

            TextField("手机号", text: $vm.phone)
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
                .textFieldStyle(TouliaoTextFieldStyle())
                .accessibilityIdentifier("login-phone-input")

            PasswordField(placeholder: "密码", text: $vm.password,
                          accessibilityId: "login-password-input")

            if vm.captchaRequired {
                HStack(spacing: 12) {
                    TextField("请输入图中字符", text: $vm.captchaText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                        .textFieldStyle(TouliaoTextFieldStyle())
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
                    .touliaoFont(14)
                    .foregroundColor(.vxinError)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("auth-error-text")
            }

            VxinGradientButton(title: "登录", loading: vm.loading, enabled: vm.canLogin, action: vm.login)
            .padding(.top, 8)
            .accessibilityIdentifier("login-submit-btn")

            ViewThatFits(in: .horizontal) {
            HStack {
                NavigationLink("注册账号") { RegisterView() }
                    .foregroundColor(.vxinGreen).fixedSize(horizontal: true, vertical: false)
                Spacer()
                NavigationLink("忘记密码") { ForgotPasswordView() }
                    .foregroundColor(.vxinTextSecondary).fixedSize(horizontal: true, vertical: false)
            }

                VStack(spacing: 12) {
                    NavigationLink("注册账号") { RegisterView() }.foregroundColor(.vxinGreen)
                    NavigationLink("忘记密码") { ForgotPasswordView() }.foregroundColor(.vxinTextSecondary)
                }
            }

            Button(showServerConfig ? "收起" : "切换服务器") { showServerConfig.toggle() }
                .touliaoFont(12)
                .foregroundColor(.vxinTextSecondary)

            if showServerConfig {
                HStack(spacing: 8) {
                    TextField("企业代码", text: $vm.tenantCode)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                        .textFieldStyle(TouliaoTextFieldStyle())
                    Button(vm.resolvingTenantCode ? "查找中…" : "连接") {
                        Task {
                            if await vm.resolveTenantCode() { showServerConfig = false }
                        }
                    }
                    .disabled(vm.resolvingTenantCode || vm.tenantCode.trimmingCharacters(in: .whitespaces).isEmpty)
                    .foregroundColor(.vxinGreen)
                }
                if let status = vm.tenantCodeStatus {
                    Text(status)
                        .touliaoFont(12)
                        .foregroundColor(.vxinTextSecondary)
                }
                Text("不知道代码？向你的公司/团队管理员索取，或在下方直接填服务器地址。")
                    .touliaoFont(12)
                    .foregroundColor(.vxinTextSecondary)

                TextField("服务器地址", text: $vm.serverURL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .textFieldStyle(TouliaoTextFieldStyle())
                Button("保存") { vm.saveServerURL(); showServerConfig = false }
                    .foregroundColor(.vxinGreen)
            }

            Spacer()
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .touliaoPage()
        .task { await vm.loadConfig() }
        .onChange(of: vm.authedUser) { user in
            if let user { session.onAuthenticated(user) }
        }
    }
}
