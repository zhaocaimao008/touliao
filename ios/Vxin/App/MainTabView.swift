import SwiftUI

/// 底部 Tab：消息 / 通讯录 / 我
struct MainTabView: View {
    let myId: String

    var body: some View {
        TabView {
            ConversationListView(myId: myId)
                .tabItem { Label("消息", systemImage: "message") }

            ContactsTab(myId: myId)
                .tabItem { Label("通讯录", systemImage: "person.2") }

            NavigationStack { ProfileView() }
                .tabItem { Label("我", systemImage: "person.crop.circle") }
        }
        .tint(.vxinGreen)
    }
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
