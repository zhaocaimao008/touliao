import Foundation

@MainActor
final class AuthViewModel: ObservableObject {
    // 登录表单
    @Published var phone = ""
    @Published var password = ""
    @Published var serverURL = ServerConfig.shared.baseURL
    // 注册额外字段
    @Published var username = ""
    @Published var inviteCode = ""   // 6位数字邀请码；是否必填由 inviteRequired 决定
    /// 注册是否需要邀请码（GET /api/config）；拉取前保守视为需要，后端最终裁决
    @Published var inviteRequired = true
    // 登录图形验证码：是否要求由后台开关 features.loginCaptcha 决定（GET /api/config），
    // 默认 false（不要求），避免开关拉取失败时误挡住所有人登录。
    @Published var captchaRequired = false
    @Published var captchaId = ""
    @Published var captchaSvg = ""       // 完整 data:image/svg+xml;base64,... 字符串
    @Published var captchaText = ""
    // 找回密码
    @Published var resetNewPassword = ""
    @Published var resetDone = false

    @Published var loading = false
    @Published var error: String?
    /// 登录/注册成功后置为对应用户；View 监听后通知 SessionStore
    @Published var authedUser: User?

    /// 后端密码规则:≥8位且含字母和数字
    private func isValidPassword(_ p: String) -> Bool {
        p.range(of: "^(?=.*[a-zA-Z])(?=.*\\d).{8,}$", options: .regularExpression) != nil
    }

    var canLogin: Bool {
        !phone.isEmpty && !password.isEmpty && !loading && (!captchaRequired || !captchaText.isEmpty)
    }
    var canRegister: Bool {
        !username.isEmpty && !phone.isEmpty && isValidPassword(password)
            && (!inviteRequired || inviteCode.count == 6) && !loading
    }
    var canReset: Bool {
        !phone.isEmpty && inviteCode.count == 6 && isValidPassword(resetNewPassword) && !loading
    }

    /// 拉取后台开关：注册是否需要邀请码、登录是否要求图形验证码。失败保持默认（邀请码需要/验证码不需要）。
    func loadConfig() async {
        guard let cfg: RegisterConfig = try? await APIClient.shared.send("api/config", authorized: false)
        else { return }
        inviteRequired = cfg.features?.inviteRequired ?? true
        let needCaptcha = cfg.features?.loginCaptcha ?? false
        captchaRequired = needCaptcha
        if needCaptcha { await loadCaptcha() }
    }

    /// 取一张新验证码图片（登录页首次加载 / 验证码错误后自动换图 / 用户点图手动换）。
    func loadCaptcha() async {
        captchaText = ""
        guard let r = try? await AuthRepository.shared.getCaptcha() else {
            captchaId = ""; captchaSvg = ""
            return
        }
        captchaId = r.captchaId
        captchaSvg = r.svgDataUrl
    }

    /// 切换服务器地址：持久化，后续请求即生效
    func saveServerURL() {
        let url = serverURL.trimmingCharacters(in: .whitespaces)
        if !url.isEmpty { ServerConfig.shared.baseURL = url }
    }

    func login() {
        guard canLogin else { return }
        saveServerURL()
        loading = true
        error = nil
        Task {
            do {
                authedUser = try await AuthRepository.shared.login(
                    phone: phone, password: password,
                    captchaId: captchaRequired ? captchaId : nil,
                    captchaText: captchaRequired ? captchaText : nil
                )
            } catch let err {
                let msg = (err as? LocalizedError)?.errorDescription ?? "登录失败"
                error = msg
                // 验证码一次核销即失效（不管猜对猜错），报错后旧图必然已经作废，直接换一张
                if captchaRequired && msg.contains("验证码") { await loadCaptcha() }
            }
            loading = false
        }
    }

    func register() {
        guard canRegister else { return }
        loading = true
        error = nil
        Task {
            do {
                authedUser = try await AuthRepository.shared.register(phone: phone, password: password, username: username, inviteCode: inviteCode)
            } catch let err {
                error = (err as? LocalizedError)?.errorDescription ?? "注册失败"
            }
            loading = false
        }
    }

    /// 找回密码:成功后置 resetDone,View 据此返回登录
    func resetPassword() {
        guard canReset else { return }
        saveServerURL()
        loading = true
        error = nil
        Task {
            do {
                try await AuthRepository.shared.resetPassword(phone: phone, inviteCode: inviteCode, newPassword: resetNewPassword)
                resetDone = true
            } catch let err {
                error = (err as? LocalizedError)?.errorDescription ?? "重置失败"
            }
            loading = false
        }
    }
}

/// GET /api/config 响应（仅取登录/注册用到的开关）。字段缺省时分别按"需要邀请码"/"不要求验证码"处理。
private struct RegisterConfig: Decodable {
    struct Features: Decodable { let inviteRequired: Bool?; let loginCaptcha: Bool? }
    let features: Features?
}
