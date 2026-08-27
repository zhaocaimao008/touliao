import SwiftUI
import Combine
import Kingfisher

@MainActor
final class FavoritesViewModel: ObservableObject {
    @Published var items: [Collection] = []          // 全量收藏
    @Published var loading = true
    @Published var error: String?
    // 搜索
    @Published var query = ""
    @Published var typeFilter = ""                    // ""=全部 | text|image|file|video
    @Published var searching = false
    @Published var results: [Collection]? = nil       // nil=未搜索(显示全量) | 数组=搜索结果

    private let repo = FavoritesRepository.shared
    private var cancellables = Set<AnyCancellable>()

    init() {
        // 关键词/类型变化 → 去抖搜索
        Publishers.CombineLatest($query, $typeFilter)
            .dropFirst()
            .debounce(for: .milliseconds(300), scheduler: RunLoop.main)
            .sink { [weak self] q, type in self?.runSearch(q: q, type: type) }
            .store(in: &cancellables)
    }

    /// 当前应展示的列表：搜索态用结果，否则全量(全量也支持类型过滤)
    var shown: [Collection] {
        if let r = results { return r }
        return typeFilter.isEmpty ? items : items.filter { $0.type == typeFilter }
    }

    var isFiltering: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty || !typeFilter.isEmpty }

    func refresh() async {
        loading = true; error = nil
        do { items = try await repo.list() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "加载收藏失败" }
        loading = false
    }

    private func runSearch(q: String, type: String) {
        let kw = q.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !kw.isEmpty else { results = nil; searching = false; return }
        searching = true
        Task {
            do { results = try await repo.search(q: kw, type: type.isEmpty ? nil : type) }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "搜索失败"; results = [] }
            searching = false
        }
    }

    func remove(_ item: Collection) {
        Task {
            do {
                try await repo.remove(item.id)
                items.removeAll { $0.id == item.id }
                if results != nil { results?.removeAll { $0.id == item.id } }
            }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "取消收藏失败" }
        }
    }
}

struct FavoritesView: View {
    @StateObject private var vm = FavoritesViewModel()

    private let typeOptions: [(String, String)] = [("", "全部"), ("text", "文字"), ("image", "图片"), ("file", "文件"), ("video", "视频")]

    var body: some View {
        VStack(spacing: 0) {
            // 类型过滤（对齐 web/后端 type 参数）
            Picker("类型", selection: $vm.typeFilter) {
                ForEach(typeOptions, id: \.0) { Text($0.1).tag($0.0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 12).padding(.vertical, 8)

            Group {
                if vm.loading && vm.items.isEmpty {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if vm.searching {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if vm.shown.isEmpty {
                    Text(vm.isFiltering ? "没有匹配的收藏" : "暂无收藏")
                        .foregroundColor(.vxinTextSecondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(vm.shown) { item in
                            row(item)
                                .swipeActions {
                                    Button("取消收藏", role: .destructive) { vm.remove(item) }
                                }
                        }
                    }
                    .listStyle(.plain)
                }
            }
        }
        .searchable(text: $vm.query, prompt: "搜索收藏")
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
