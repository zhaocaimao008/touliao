import SwiftUI

@MainActor
final class BlockedViewModel: ObservableObject {
    @Published var users: [BlockedUser] = []
    @Published var loading = true
    @Published var error: String?

    private let repo = ContactRepository.shared

    func refresh() async {
        loading = true; error = nil
        do { users = try await repo.listBlocked() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "加载黑名单失败" }
        loading = false
    }

    func unblock(_ user: BlockedUser) {
        Task {
            do { try await repo.unblock(user.id); users.removeAll { $0.id == user.id } }
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
                    HStack(spacing: 12) {
                        InitialAvatar(name: user.username.isEmpty ? "?" : user.username, size: 44)
                        Text(user.username.isEmpty ? "未命名" : user.username)
                        Spacer()
                        Button("移出") { vm.unblock(user) }
                            .buttonStyle(.borderless).foregroundColor(.vxinGreen)
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("黑名单")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.refresh() }
    }
}
