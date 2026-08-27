import SwiftUI

/// 搜索导航路由
enum SearchRoute: Hashable { case search }

struct SearchView: View {
    var onOpenResult: (SearchResult) -> Void

    @StateObject private var vm = SearchViewModel()
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            TextField("搜索聊天记录", text: $vm.query)
                .textFieldStyle(.roundedBorder)
                .focused($searchFocused)
                .submitLabel(.search)
                .padding(12)
                // 进入搜索页自动聚焦并弹出键盘(对齐微信/安卓)
                .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { searchFocused = true } }

            if vm.loading {
                Spacer(); ProgressView(); Spacer()
            } else if vm.query.trimmingCharacters(in: .whitespaces).isEmpty {
                Spacer()
                VxinEmptyState(systemImage: "magnifyingglass", title: "搜索聊天记录", subtitle: "输入关键词查找消息")
                Spacer()
            } else if vm.searched && vm.results.isEmpty {
                Spacer()
                VxinEmptyState(systemImage: "text.magnifyingglass", title: "没有找到相关消息")
                Spacer()
            } else {
                List(vm.results) { r in
                    Button { onOpenResult(r) } label: {
                        HStack(spacing: 12) {
                            InitialAvatar(name: r.convName.isEmpty ? "?" : r.convName, size: 44)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(r.convName.isEmpty ? "会话" : r.convName).foregroundColor(.primary).lineLimit(1)
                                Text(highlighted(prefix: r.senderName.isEmpty ? "" : "\(r.senderName): ", content: r.content, query: vm.query))
                                    .font(.subheadline).lineLimit(1)
                            }
                            Spacer()
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("搜索")
        .navigationBarTitleDisplayMode(.inline)
        .toast($vm.error)
    }

    /// 内容中匹配 query 的片段高亮为绿色加粗；发送者名前缀不高亮。
    private func highlighted(prefix: String, content: String, query: String) -> AttributedString {
        var attr = AttributedString(prefix)
        attr.foregroundColor = .vxinTextSecondary
        var body = AttributedString(content)
        body.foregroundColor = .vxinTextSecondary
        let q = query.trimmingCharacters(in: .whitespaces)
        if !q.isEmpty {
            var search = body.startIndex
            while let range = body[search...].range(of: q, options: .caseInsensitive) {
                body[range].foregroundColor = .vxinGreen
                body[range].font = .subheadline.bold()
                search = range.upperBound
            }
        }
        attr.append(body)
        return attr
    }
}
