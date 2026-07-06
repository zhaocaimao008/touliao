import SwiftUI
import Kingfisher

@MainActor
final class FavoritesViewModel: ObservableObject {
    @Published var items: [Collection] = []
    @Published var loading = true
    @Published var error: String?

    private let repo = FavoritesRepository.shared

    func refresh() async {
        loading = true; error = nil
        do { items = try await repo.list() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "加载收藏失败" }
        loading = false
    }

    func remove(_ item: Collection) {
        Task {
            do { try await repo.remove(item.id); items.removeAll { $0.id == item.id } }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "取消收藏失败" }
        }
    }
}

struct FavoritesView: View {
    @StateObject private var vm = FavoritesViewModel()

    var body: some View {
        Group {
            if vm.loading && vm.items.isEmpty {
                ProgressView()
            } else if vm.items.isEmpty {
                Text("暂无收藏").foregroundColor(.vxinTextSecondary)
            } else {
                List {
                    ForEach(vm.items) { item in
                        row(item)
                            .swipeActions {
                                Button("取消收藏", role: .destructive) { vm.remove(item) }
                            }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("收藏")
        .navigationBarTitleDisplayMode(.inline)
        .toast($vm.error)
        .task { await vm.refresh() }
    }

    @ViewBuilder private func row(_ item: Collection) -> some View {
        switch item.type {
        case "image":
            if let src = MediaUrlResolver.kfSource(raw: item.extra.fileUrl) {
                KFImage(source: src).resizable().scaledToFit().frame(maxHeight: 200)
            } else { Text("[图片]") }
        case "file":
            Text("📄 \(item.content.isEmpty ? "文件" : item.content)")
        case "video":
            Text("🎬 视频")
        default:
            Text(item.content)
        }
    }
}
