import Foundation

@MainActor
final class AuthViewModel: ObservableObject {
    // 登录表单
    @Published var phone = ""
    @Published var password = ""
    @Published var serverURL = ServerConfig.shared.baseURL
    // 注册额外字段
    @Published var username = ""

    @Published var loading = false
    @Published var error: String?
    /// 登录/注册成功后置为对应用户；View 监听后通知 SessionStore
    @Published var authedUser: User?

    var canLogin: Bool { !phone.isEmpty && !password.isEmpty && !loading }
    var canRegister: Bool { !username.isEmpty && !phone.isEmpty && password.count >= 6 && !loading }

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
                authedUser = try await AuthRepository.shared.login(phone: phone, password: password)
            } catch let err {
                error = (err as? LocalizedError)?.errorDescription ?? "登录失败"
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
                authedUser = try await AuthRepository.shared.register(phone: phone, password: password, username: username)
            } catch let err {
                error = (err as? LocalizedError)?.errorDescription ?? "注册失败"
            }
            loading = false
        }
    }
}
