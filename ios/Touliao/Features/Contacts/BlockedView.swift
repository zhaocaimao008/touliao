import Combine
import SwiftUI

@MainActor
final class BlockedViewModel: ObservableObject {
    @Published var users: [BlockedUser] = []
    @Published var loading = true
    @Published var error: String?

    private let socialGuard = SocialReadGuard()
    private var socialSubscription: AnyCancellable?
    private let repo = ContactRepository.shared

    init() {
        socialSubscription = SocketService.shared.socialState.dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in Task { @MainActor in await self?.refresh() } }
    }

    func refresh() async {
        guard let stamp = socialGuard.begin() else { return }
        loading = true; error = nil
        do { let fresh = try await repo.listBlocked()
            guard socialGuard.current(stamp) else { return }
            users = fresh }
        catch { guard socialGuard.current(stamp) else { return }; self.error = (error as? LocalizedError)?.errorDescription ?? "加载黑名单失败" }
        loading = false
    }

    func unblock(_ user: BlockedUser) {
        Task {
            do { try await repo.unblock(user.id); await refresh() }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "移出黑名单失败" }
        }
    }
}

struct BlockedView: View {
    @StateObject private var vm = BlockedViewModel()

    var body: some View {
        Group {
            if vm.loading && vm.users.isEmpty {
                ProgressView()
            } else if vm.users.isEmpty {
                Text("黑名单为空").foregroundColor(.vxinTextSecondary)
            } else {
                List(vm.users) { user in
                    Group {
                    HStack(spacing: 12) {
                        InitialAvatar(name: user.username.isEmpty ? "?" : user.username, size: 44)
                        Text(user.username.isEmpty ? "未命名" : user.username)
                        Spacer()
                        Button("移出") { vm.unblock(user) }
                            .buttonStyle(.borderless).foregroundColor(.vxinGreen)
                    }
                    }.listRowBackground(Color.vxinSurface).listRowSeparatorTint(Color.vxinBorder)
                }
                .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.vxinSurface)
            }
        }
        .navigationTitle("黑名单")
        .navigationBarTitleDisplayMode(.inline)
        .touliaoPage()
        .task { await vm.refresh() }
    }
}
