import SwiftUI

/// 搜索导航路由
enum SearchRoute: Hashable { case search }

struct SearchView: View {
    var onOpenResult: (SearchResult) -> Void

    @StateObject private var vm = SearchViewModel()

    var body: some View {
        VStack(spacing: 0) {
            TextField("搜索聊天记录", text: $vm.query)
                .textFieldStyle(.roundedBorder)
                .padding(12)

            if vm.loading {
                Spacer(); ProgressView(); Spacer()
            } else if vm.query.trimmingCharacters(in: .whitespaces).isEmpty {
                Spacer(); Text("输入关键词搜索聊天记录").foregroundColor(.vxinTextSecondary); Spacer()
            } else if vm.searched && vm.results.isEmpty {
                Spacer(); Text("没有找到相关消息").foregroundColor(.vxinTextSecondary); Spacer()
            } else {
                List(vm.results) { r in
                    Button { onOpenResult(r) } label: {
                        HStack(spacing: 12) {
                            InitialAvatar(name: r.convName.isEmpty ? "?" : r.convName, size: 44)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(r.convName.isEmpty ? "会话" : r.convName).foregroundColor(.primary).lineLimit(1)
                                Text(r.senderName.isEmpty ? r.content : "\(r.senderName): \(r.content)")
                                    .font(.subheadline).foregroundColor(.vxinTextSecondary).lineLimit(1)
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
    }
}
