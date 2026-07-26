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
    /// 已登录账号列表（@Published：移除/添加/切换后 UI 自动刷新）。
    /// 修复：之前 View 直接调 accounts() 方法读取，移除账号后 SessionStore 不发布变更，
    /// ForEach 不重渲染 → 被移除的账号仍显示在列表里（iOS 移除账户 UI 不刷新的 bug）。
    @Published private(set) var accountList: [StoredAccount] = AccountStore.shared.accounts()

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
        refreshAccounts()   // 登录成功后 AuthRepository 已 upsert 新账号，同步发布列表
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
    func accounts() -> [StoredAccount] { accountList }
    var activeAccountId: String? { AccountStore.shared.activeId() }

    /// 从 AccountStore 重新读取并发布（任何账号增删改后调用，驱动 UI 刷新）。
    func refreshAccounts() { accountList = AccountStore.shared.accounts() }

    func switchAccount(_ id: String) {
        guard let token = AccountStore.shared.token(for: id) else { return }
        SocketService.shared.disconnect()
        AccountStore.shared.setActive(id)
        KeychainStore.shared.token = token
        SocketService.shared.connect()
        PushManager.shared.requestAuthorizationAndRegister()
        refreshAccounts()   // active 变化 → 刷新「当前」标记
        Task { await restoreSession() }
    }

    func removeAccount(_ id: String) {
        if id != AccountStore.shared.activeId() {
            AccountStore.shared.remove(id)
            refreshAccounts()   // 关键修复：移除后立即发布，列表实时去掉该账号
        }
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
        MsgCacheStore.shared.clear()   // 离线消息缓存全清（隐私红线）
        refreshAccounts()
        state = .unauthenticated
    }

    func logout() async {
        await PushManager.shared.unregister()
        SocketService.shared.disconnect()
        await repo.logout()
        MsgCacheStore.shared.clear()   // 离线消息缓存全清（隐私红线：登出/切账号）
        refreshAccounts()   // AuthRepository.logout 已移除当前账号，同步发布列表
        state = .unauthenticated
    }
}
