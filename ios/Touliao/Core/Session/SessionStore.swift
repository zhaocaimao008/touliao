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

    private var restoreGeneration = 0
    @Published private(set) var recoveryMessage: String?
    private let repo = AuthRepository.shared
    private var observer: NSObjectProtocol?
    private var socketAuthCancellable: AnyCancellable?

    private func clearIdentityResources() {
        AudioPlayerService.shared.stop()
        CallManager.shared.resetForAccountChange()
        GroupCallManager.shared.resetForAccountChange()
        PushManager.shared.clearDisplayedNotifications()
    }

    private func beginIdentityChange() {
        restoreGeneration += 1
        recoveryMessage = nil
        clearIdentityResources()
        KeychainStore.shared.beginIdentityChange()
    }

    init() {
        observer = NotificationCenter.default.addObserver(
            forName: APIClient.unauthorizedNotification, object: nil, queue: .main
        ) { [weak self] notification in
            guard let marker = notification.object as? KeychainStore.Snapshot else { return }
            Task { @MainActor in
                KeychainStore.shared.withCurrent(marker) {
                    self?.clearIdentityResources()
                    SocketService.shared.disconnect()
                    self?.state = .unauthenticated
                }
            }
        }
        // socket 鉴权失败（token 失效/封禁/会话过期）→ 同样踢回登录页。
        // 服务端在 handshake 校验失败时发 connect_error，SocketService 判定为致命
        // 鉴权错误后停止重连并发出 authFailure；这里消费并登出，避免旧 token 无限重连。
        socketAuthCancellable = SocketService.shared.authFailure
            .receive(on: DispatchQueue.main)
            .sink { [weak self] failure in
                Task { @MainActor in
                    KeychainStore.shared.withCurrent(failure.credential) {
                        self?.clearIdentityResources()
                        SocketService.shared.disconnect()
                        self?.state = .unauthenticated
                        self?.lastAuthError = failure.message
                    }
                }
            }
        // 先拉远程配置确定服务器地址，再恢复会话
        Task {
            await RemoteConfig.refresh()
            await restoreSession()
        }
    }

    /// socket 鉴权失败的最近一条错误消息（供 UI 提示，如「登录已过期，请重新登录」）。
    @Published private(set) var lastAuthError: String?

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    func restoreSession() async {
        restoreGeneration += 1
        let generation = restoreGeneration
        let credential = KeychainStore.shared.snapshot()
        guard let token = credential.token, !token.isEmpty else { state = .unauthenticated; return }
        let cached = AccountStore.shared.accounts().first { $0.id == AccountStore.shared.activeId() && $0.token == token }
        if let cached { state = .authenticated(User(id: cached.id, username: cached.username, avatar: cached.avatar)) }
        var delay: UInt64 = 1_000_000_000
        while KeychainStore.shared.isCurrent(credential) && generation == restoreGeneration && !Task.isCancelled {
            do {
                guard let user = try await repo.restoreSession() else { return }
                guard generation == restoreGeneration else { return }
                KeychainStore.shared.withCurrent(credential) {
                    if let cached, cached.id != user.id { MsgCacheStore.shared.clear() }
                    AccountStore.shared.upsertActive(StoredAccount(id: user.id, username: user.username, avatar: user.avatar, token: token))
                    recoveryMessage = nil
                    state = .authenticated(user)
                    refreshAccounts()
                    SocketService.shared.connect()
                    PushManager.shared.requestAuthorizationAndRegister()
                }
                return
            } catch is CancellationError { return }
            catch {
                guard KeychainStore.shared.isCurrent(credential), generation == restoreGeneration else { return }
                if case APIError.unauthorized = error {
                    beginIdentityChange()
                    SocketService.shared.disconnect()
                    if let id = AccountStore.shared.activeId() { AccountStore.shared.remove(id) }
                    KeychainStore.shared.clear()
                    MsgCacheStore.shared.clear()
                    refreshAccounts()
                    state = .unauthenticated
                    return
                }
                if case APIError.server(403, let message) = error {
                    clearIdentityResources()
                    SocketService.shared.disconnect()
                    recoveryMessage = message ?? "账号访问被拒绝或已封禁，请联系管理员"
                    lastAuthError = recoveryMessage
                    state = .unauthenticated
                    return
                }
                switch error {
                case APIError.timeout: recoveryMessage = "连接超时，正在重试"
                case APIError.network: recoveryMessage = "网络不可用，正在重试"
                default: recoveryMessage = "服务暂时不可用，正在重试"
                }
            }
            do { try await Task.sleep(nanoseconds: delay) } catch { return }
            delay = min(delay * 2, 30_000_000_000)
        }
    }

    func onAuthenticated(_ user: User) {
        guard AccountStore.shared.activeId() == user.id else { return }
        beginIdentityChange()
        // 添加账号/切号场景：Token 已换新，强制断开旧 Socket 再按新 Token 重连，避免跨账号串线
        SocketService.shared.disconnect()
        MsgCacheStore.shared.clear()   // 账号级缓存隔离：先清缓存再连接，避免新连接消息被误清
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
        beginIdentityChange()
        state = .loading
        let operation = KeychainStore.shared.snapshot()
        Task {
            guard KeychainStore.shared.isCurrent(operation) else { return }
            // 须在覆盖 KeychainStore.token 之前 await 完成，否则 unregister() 里的删除请求
            // 可能用新账号的 token 认证，导致删的是新账号身份而不是旧账号的 push token，
            // 旧账号 token 原样留在后端（见 AUDIT.md 十四节"串号推送"）
            await PushManager.shared.unregister()
            guard KeychainStore.shared.withCurrent(operation, {
                SocketService.shared.disconnect()
                AccountStore.shared.setActive(id)
                KeychainStore.shared.token = token
                MsgCacheStore.shared.clear()
                refreshAccounts()
            }) else { return }
            await restoreSession()
        }
    }

    func removeAccount(_ id: String) {
        if id != AccountStore.shared.activeId() {
            AccountStore.shared.remove(id)
            refreshAccounts()   // 关键修复：移除后立即发布，列表实时去掉该账号
        }
    }

    /// 改密后应用新签发的 token：覆盖当前 Bearer token 与本账号已存 token，避免旧 token 失效被登出。
    @discardableResult func applyNewToken(_ token: String, expected: KeychainStore.Snapshot) -> Bool {
        KeychainStore.shared.installReplacement(expected, token: token) {
            if let active = AccountStore.shared.activeId() { AccountStore.shared.updateToken(active, token) }
            SocketService.shared.disconnect()
            SocketService.shared.connect()
            PushManager.shared.refreshRegistrationIfNeeded()
        }
    }

    /// 注销账户成功后本地收尾：清登录态回登录页（与 logout 一致，但不再调 /logout）。
    func deleteAccount() async {
        beginIdentityChange()
        let credential = KeychainStore.shared.snapshot()
        await PushManager.shared.unregister()
        KeychainStore.shared.withCurrent(credential) {
            SocketService.shared.disconnect()
            if let active = AccountStore.shared.activeId() { AccountStore.shared.remove(active) }
            KeychainStore.shared.clear()
            MsgCacheStore.shared.clear()
            refreshAccounts()
            state = .unauthenticated
        }
    }

    func logout() async {
        beginIdentityChange()
        let credential = KeychainStore.shared.snapshot()
        await PushManager.shared.unregister()
        guard KeychainStore.shared.isCurrent(credential) else { return }
        SocketService.shared.disconnect()
        guard let marker = await repo.logout() else { return }
        KeychainStore.shared.withCurrent(marker) {
            MsgCacheStore.shared.clear()
            refreshAccounts()
            state = .unauthenticated
        }
    }
}
