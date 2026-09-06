import SwiftUI

/// 搜索导航路由
enum SearchRoute: Hashable { case search }

struct SearchView: View {
    var onOpenResult: (SearchResult) -> Void

    @StateObject private var vm = SearchViewModel()
    @FocusState private var searchFocused: Bool

    private var hasQuery: Bool { !vm.query.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        VStack(spacing: 0) {
            TextField("搜索聊天记录", text: $vm.query)
                .textFieldStyle(.roundedBorder)
                .focused($searchFocused)
                .submitLabel(.search)
                .padding(12)
                // 进入搜索页自动聚焦并弹出键盘(对齐微信/安卓)
                .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { searchFocused = true } }

            // F5 搜索筛选（对齐 Web gs-filters）：类型下拉 + 时间 chips + 发送人下拉。
            // 仅筛选激活时请求带 type/from/to/senderId（VM 构造参数时跳过空值）。
            if hasQuery {
                filterBar
            }

            if vm.loading {
                Spacer(); ProgressView(); Spacer()
            } else if !hasQuery {
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
                                // 类型图标 + 摘要（F5：结构化消息透出人话字段，不泄原始 JSON；对齐 Web gs-msg-type-icon）
                                HStack(alignment: .firstTextBaseline, spacing: 4) {
                                    Text(messageSearchTypeIcon(r.type))
                                        .font(.subheadline)
                                        .foregroundColor(.vxinTextSecondary)
                                    Text(highlighted(prefix: r.senderName.isEmpty ? "" : "\(r.senderName): ",
                                                     summary: formatSearchMessageSummary(type: r.type, content: r.content),
                                                     query: vm.query))
                                        .font(.subheadline).lineLimit(1)
                                }
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

    // MARK: - 筛选栏（F5）
    private var filterBar: some View {
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                // 类型筛选
                Picker("类型", selection: $vm.typeFilter) {
                    ForEach(messageSearchTypes) { option in
                        Text(option.label).tag(option.value)
                    }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity, alignment: .leading)
                // 发送人筛选（选项来自已搜结果聚合；Web 同款——无独立成员接口）
                if !vm.senderOptions.isEmpty {
                    Picker("发送人", selection: $vm.senderId) {
                        Text("所有发送人").tag("")
                        ForEach(vm.senderOptions, id: \.id) { sender in
                            Text(sender.name.isEmpty ? "用户\(String(sender.id.suffix(4)))" : sender.name).tag(sender.id)
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
            // 时间 chips（不限/今天/7天/30天）
            HStack(spacing: 8) {
                ForEach(messageSearchTimeRanges) { option in
                    Button {
                        vm.timeRange = option.value
                    } label: {
                        Text(option.label)
                            .font(.caption)
                            .padding(.horizontal, 12).padding(.vertical, 5)
                            .background(vm.timeRange == option.value ? Color.vxinGreen.opacity(0.15) : Color.gray.opacity(0.1))
                            .foregroundColor(vm.timeRange == option.value ? .vxinGreen : .vxinTextSecondary)
                            .clipShape(Capsule())
                    }
                }
                Spacer()
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    /// 摘要中匹配 query 的片段高亮为绿色加粗；发送者名前缀不高亮。
    private func highlighted(prefix: String, summary: String, query: String) -> AttributedString {
        var attr = AttributedString(prefix)
        attr.foregroundColor = .vxinTextSecondary
        var body = AttributedString(summary)
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
