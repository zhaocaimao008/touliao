import SwiftUI

/// 底部 Tab：消息 / 通讯录 / 朋友圈 / 收藏 / 我（四端一致）
/// 朋友圈 / 收藏 受后台功能开关控制（GET /api/config），可隐藏。
struct MainTabView: View {
    let myId: String

    // 后台开关：默认全开，拉取失败不误伤
    @State private var showMoments = true
    @State private var showFavorites = true

    var body: some View {
        TabView {
            ConversationListView(myId: myId)
                .tabItem { Label("消息", systemImage: "message") }

            ContactsTab(myId: myId)
                .tabItem { Label("通讯录", systemImage: "person.2") }

            if showMoments {
                NavigationStack { MomentsView().navigationTitle("朋友圈") }
                    .tabItem { Label("朋友圈", systemImage: "photo.on.rectangle") }
            }

            if showFavorites {
                NavigationStack { FavoritesView() }
                    .tabItem { Label("收藏", systemImage: "star") }
            }

            NavigationStack { ProfileView() }
                .tabItem { Label("我", systemImage: "person.crop.circle") }
        }
        .tint(.vxinGreen)
        .task { await loadFeatures() }
    }

    private func loadFeatures() async {
        guard let cfg: AppConfig = try? await APIClient.shared.send("api/config", authorized: false)
        else { return }   // 拉取失败：维持默认全开
        showMoments = cfg.features?.moments ?? true
        showFavorites = cfg.features?.collect ?? true
    }
}

/// GET /api/config 响应（后台功能开关）。字段可缺省，缺省按全开处理。
private struct AppConfig: Decodable {
    struct Features: Decodable {
        let moments: Bool?
        let collect: Bool?
    }
    let features: Features?
}

/// 通讯录 Tab：自带导航栈，处理 添加好友/新的朋友/发起群聊 与 发起聊天
private struct ContactsTab: View {
    let myId: String
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            ContactsView(
                onStartChat: { path.append($0) },
                onAddFriend: { path.append(ContactRoute.addFriend) },
                onRequests: { path.append(ContactRoute.requests) },
                onCreateGroup: { path.append(ContactRoute.createGroup) },
                onOpenBlocked: { path.append(ContactRoute.blocked) }
            )
            .navigationDestination(for: Conversation.self) { conv in
                ChatView(conversation: conv, myId: myId, onOpenGroupInfo: { path.append(GroupRoute.info(conv.id)) })
            }
            .navigationDestination(for: GroupRoute.self) { route in
                switch route {
                case .info(let id):
                    GroupInfoView(conversationId: id, onInvite: { path.append(GroupRoute.invite(id)) }, onLeft: { path.removeLast(path.count) })
                case .invite(let id):
                    InviteMembersView(conversationId: id, onDone: { if !path.isEmpty { path.removeLast() } })
                }
            }
            .navigationDestination(for: ContactRoute.self) { route in
                switch route {
                case .contacts:
                    ContactsView(
                        onStartChat: { path.append($0) },
                        onAddFriend: { path.append(ContactRoute.addFriend) },
                        onRequests: { path.append(ContactRoute.requests) },
                        onCreateGroup: { path.append(ContactRoute.createGroup) },
                        onOpenBlocked: { path.append(ContactRoute.blocked) }
                    )
                case .addFriend:
                    AddFriendView()
                case .requests:
                    FriendRequestsView()
                case .createGroup:
                    CreateGroupView(onCreated: { conv in
                        path.removeLast(path.count)
                        path.append(conv)
                    })
                case .blocked:
                    BlockedView()
                }
            }
        }
    }
}
