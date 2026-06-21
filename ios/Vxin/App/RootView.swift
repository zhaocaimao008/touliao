import SwiftUI

/// 根视图：按会话状态切换 启动中 / 登录流 / 已登录。
/// 已登录目前是占位页，聊天阶段替换为会话列表。
struct RootView: View {
    @EnvironmentObject private var session: SessionStore

    var body: some View {
        switch session.state {
        case .loading:
            ProgressView()
        case .unauthenticated:
            NavigationStack { LoginView() }
        case .authenticated(let user):
            MainTabView(myId: user.id)
        }
    }
}
