import SwiftUI

/// 根视图：按会话状态切换 启动中 / 登录流 / 已登录。
/// 已登录目前是占位页，聊天阶段替换为会话列表。
struct RootView: View {
    @EnvironmentObject private var session: SessionStore
    // 外观本地设置：主题与字号，app 级即时生效
    @AppStorage(AppearanceStore.themeKey) private var themeRaw = AppTheme.system.rawValue
    @AppStorage(AppearanceStore.fontKey) private var fontRaw = AppFontScale.standard.rawValue

    var body: some View {
        content
            .preferredColorScheme((AppTheme(rawValue: themeRaw) ?? .system).colorScheme)
            .dynamicTypeSize((AppFontScale(rawValue: fontRaw) ?? .standard).dynamicTypeSize)
    }

    @ViewBuilder private var content: some View {
        switch session.state {
        case .loading:
            ProgressView()
        case .unauthenticated:
            NavigationStack { LoginView() }
        case .authenticated(let user):
            MainTabView(myId: user.id)
                .overlay(CallHostView())
                .overlay(GroupCallHostView())
        }
    }
}
