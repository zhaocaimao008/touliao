import SwiftUI
import Combine

/// 「发现」Tab（四端一致）：朋友圈 / 通话记录 / 收藏。朋友圈、收藏受后台开关控制。
/// momentUnread 同时驱动底部「发现」Tab 角标（由 MainTabView 持有本 ViewModel）。
@MainActor
final class DiscoverViewModel: ObservableObject {
    @Published var momentsEnabled = true
    @Published var collectEnabled = true
    @Published var momentUnread = 0
    private var cancellables = Set<AnyCancellable>()

    init() {
        SocketService.shared.moments
            .sink { [weak self] _ in Task { @MainActor in await self?.refreshUnread() } }
            .store(in: &cancellables)
        ChatRepository.shared.configUpdatedPublisher
            .sink { [weak self] update in Task { @MainActor in
                self?.momentsEnabled = update.moments
                await self?.refreshUnread()
            } }
            .store(in: &cancellables)
        Task { await load() }
    }

    func load() async {
        struct Config: Decodable {
            struct Features: Decodable { let moments: Bool?; let collect: Bool? }
            let features: Features?
        }
        if let cfg: Config = try? await APIClient.shared.send("api/config", authorized: false) {
            momentsEnabled = cfg.features?.moments ?? true
            collectEnabled = cfg.features?.collect ?? true
        }
        await refreshUnread()
    }

    /// 朋友圈关闭时接口 403，按 0 处理
    func refreshUnread() async {
        guard momentsEnabled else { momentUnread = 0; return }
        momentUnread = (try? await MomentRepository.shared.notifUnreadCount()) ?? 0
    }
}

struct DiscoverView: View {
    @ObservedObject var vm: DiscoverViewModel

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if vm.momentsEnabled {
                        NavigationLink(destination: MomentsView()) {
                            row(icon: "discover", title: "朋友圈", badge: vm.momentUnread)
                        }
                        .accessibilityIdentifier("discover-moments")
                    }
                    NavigationLink(destination: CallHistoryView()) {
                        row(icon: "phone", title: "通话记录", badge: 0)
                    }
                    .accessibilityIdentifier("discover-calls")
                    if vm.collectEnabled {
                        NavigationLink(destination: FavoritesView()) {
                            row(icon: "favorite", title: "收藏", badge: 0)
                        }
                        .accessibilityIdentifier("discover-favorites")
                    }
                }
            }
            .navigationTitle("发现")
            // 从朋友圈返回时刷新红点（进入互动消息后已读）
            .onAppear { Task { await vm.refreshUnread() } }
        }
    }

    private func row(icon: String, title: String, badge: Int) -> some View {
        HStack(spacing: 14) {
            TouliaoIcon(icon, size: .md).foregroundColor(.vxinBrand)
            Text(title).foregroundColor(.vxinText)
            Spacer()
            if badge > 0 {
                Text(badge > 99 ? "99+" : "\(badge)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 6).frame(minWidth: 20, minHeight: 20)
                    .background(Capsule().fill(Color.red))
            }
        }
        .padding(.vertical, 4)
    }
}
