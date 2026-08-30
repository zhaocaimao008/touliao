import SwiftUI

// MARK: - @我消息聚合 ViewModel

// 分页方式：offset → (createdAt, msgId) 复合游标，见 AUDIT.md 第九节"分页方式"🟡。
// offset 在翻页途中有新 @我消息插入时会把"第N条"的相对位置整体往后推，导致下一页
// 重复看到上一页最后几条；游标锚定在具体某条消息上不受影响。
@MainActor
final class MentionsViewModel: ObservableObject {
    @Published var items: [MentionItem] = []
    @Published var loading = false
    @Published var hasMore = true
    @Published var error: String?

    private let limit = 20
    private let repo = ChatRepository.shared

    /// 首次加载（重置分页，不带游标）
    func loadFirst() async {
        items = []; hasMore = true
        await loadNext()
    }

    /// 加载下一页：用当前已加载列表最后一条（时间上最旧的一条）作为游标
    func loadNext() async {
        guard hasMore, !loading else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            let cursor = items.last
            let page = try await repo.mentionsMe(before: cursor?.createdAt, beforeId: cursor?.id, limit: limit)
            items += page.items
            hasMore = page.hasMore
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "加载失败"
        }
    }
}

// MARK: - @我消息聚合 View（全屏）

struct MentionsView: View {
    let myId: String
    var onOpenConversation: (Conversation) -> Void

    @StateObject private var vm = MentionsViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if vm.loading && vm.items.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let err = vm.error, vm.items.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 36)).foregroundColor(.vxinTextSecondary)
                        Text(err).foregroundColor(.vxinError)
                        Button("重试") { Task { await vm.loadFirst() } }
                            .foregroundColor(.vxinGreen)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if vm.items.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "at.circle")
                            .font(.system(size: 48)).foregroundColor(.vxinTextSecondary)
                        Text("暂无 @ 我的消息").foregroundColor(.vxinTextSecondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(vm.items) { item in
                            Button {
                                let conv = Conversation(id: item.convId, name: item.convName)
                                dismiss()
                                // 短暂延迟等 dismiss 动画完成再跳转
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                                    onOpenConversation(conv)
                                }
                            } label: {
                                MentionRow(item: item)
                            }
                            .buttonStyle(.plain)
                            // 滚到最后一项时触发加载更多
                            .onAppear {
                                if item.id == vm.items.last?.id && vm.hasMore {
                                    Task { await vm.loadNext() }
                                }
                            }
                        }
                        // 分页加载指示
                        if vm.loading && !vm.items.isEmpty {
                            HStack { Spacer(); ProgressView(); Spacer() }
                                .listRowSeparator(.hidden)
                        }
                    }
                    .listStyle(.plain)
                    .refreshable { await vm.loadFirst() }
                }
            }
            .navigationTitle("@我")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("关闭") { dismiss() }
                }
            }
        }
        .task { await vm.loadFirst() }
    }
}

// MARK: - @我消息行

private struct MentionRow: View {
    let item: MentionItem

    var body: some View {
        HStack(spacing: 12) {
            // 会话头像
            InitialAvatar(name: item.convName.isEmpty ? "?" : item.convName, size: 44)

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(item.convName.isEmpty ? "未知会话" : item.convName)
                        .font(.body).lineLimit(1)
                    Spacer()
                    Text(formatChatTime(item.createdAt))
                        .font(.caption2).foregroundColor(.vxinTextSecondary)
                }
                HStack(spacing: 4) {
                    // 发送者名（谁 @了我）
                    Text(item.senderName.isEmpty ? "某人" : item.senderName)
                        .font(.subheadline).foregroundColor(.vxinGreen).lineLimit(1)
                    Text(": \(item.content)")
                        .font(.subheadline).foregroundColor(.vxinTextSecondary).lineLimit(1)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
