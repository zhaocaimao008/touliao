import Foundation
import Combine

/// 全局会话状态的单一事实来源（对应 Android SessionManager）。
/// - 启动 restoreSession
/// - 订阅 401 通知 → 自动登出
/// - 登录成功 / 登出更新状态
/// 后续聊天阶段在此挂载 SocketManager 的 connect()/disconnect()。
@MainActor
final class SessionStore: ObservableObject {

    enum AuthState: Equatable {
        case loading
        case unauthenticated
        case authenticated(User)
    }

    @Published private(set) var state: AuthState = .loading

    private let repo = AuthRepository.shared
    private var observer: NSObjectProtocol?

    init() {
        observer = NotificationCenter.default.addObserver(
            forName: APIClient.unauthorizedNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                SocketService.shared.disconnect()
                self?.state = .unauthenticated
            }
        }
        // 先拉远程配置确定服务器地址，再恢复会话
        Task {
            await RemoteConfig.refresh()
            await restoreSession()
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    func restoreSession() async {
        if let user = await repo.restoreSession() {
            SocketService.shared.connect()
            PushManager.shared.requestAuthorizationAndRegister()
            state = .authenticated(user)
        } else {
            state = .unauthenticated
        }
    }

    func onAuthenticated(_ user: User) {
        SocketService.shared.connect()
        PushManager.shared.requestAuthorizationAndRegister()
        state = .authenticated(user)
    }

    var currentUser: User? {
        if case .authenticated(let user) = state { return user }
        return nil
    }

    /// 资料更新后刷新当前用户（不改变登录态）
    func updateCurrentUser(_ user: User) {
        if case .authenticated = state { state = .authenticated(user) }
    }

    // MARK: - 多账号
    func accounts() -> [StoredAccount] { AccountStore.shared.accounts() }
    var activeAccountId: String? { AccountStore.shared.activeId() }

    func switchAccount(_ id: String) {
        guard let token = AccountStore.shared.token(for: id) else { return }
        SocketService.shared.disconnect()
        AccountStore.shared.setActive(id)
        KeychainStore.shared.token = token
        SocketService.shared.connect()
        PushManager.shared.requestAuthorizationAndRegister()
        Task { await restoreSession() }
    }

    func removeAccount(_ id: String) {
        if id != AccountStore.shared.activeId() { AccountStore.shared.remove(id) }
    }

    /// 改密后应用新签发的 token：覆盖当前 Bearer token 与本账号已存 token，避免旧 token 失效被登出。
    func applyNewToken(_ token: String) {
        guard !token.isEmpty else { return }
        KeychainStore.shared.token = token
        if let active = AccountStore.shared.activeId() { AccountStore.shared.updateToken(active, token) }
    }

    /// 注销账户成功后本地收尾：清登录态回登录页（与 logout 一致，但不再调 /logout）。
    func deleteAccount() async {
        await PushManager.shared.unregister()
        SocketService.shared.disconnect()
        if let active = AccountStore.shared.activeId() { AccountStore.shared.remove(active) }
        KeychainStore.shared.clear()
        state = .unauthenticated
    }

    func logout() async {
        await PushManager.shared.unregister()
        SocketService.shared.disconnect()
        await repo.logout()
        state = .unauthenticated
    }
}
