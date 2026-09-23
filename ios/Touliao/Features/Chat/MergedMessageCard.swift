import SwiftUI

/// 合并转发消息气泡卡片（F5，对齐 Web MergedMessageCard）：标题 + 前 2 条摘要 +「查看 N 条记录」，
/// 点击弹浏览列表（只读不跳转原会话——摘要不含原始媒体，与 Web/Android 口径一致）。
struct MergedMessageCard: View {
    let content: String
    /// 卡片配色随气泡（isMine=白字渐变底 / 对方=主色浅底）
    var isMine: Bool = false

    @State private var showDetail = false

    private var record: MergedForwardContent { parseMergedContent(content) }

    var body: some View {
        card
            .onTapGesture { showDetail = true }
            .sheet(isPresented: $showDetail) {
                MergedForwardDetailSheet(title: record.title, items: record.items)
            }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(record.title.isEmpty ? "聊天记录" : record.title)
                .touliaoText(.secondary, weight: .bold)
                .lineLimit(1)
            // 摘要最多 2 条（对齐 Web wc-merged-summary）
            ForEach(Array(record.items.prefix(2).enumerated()), id: \.offset) { _, item in
                Text("\(item.senderName.isEmpty ? "" : "\(item.senderName): ")\(item.snippet)")
                    .touliaoText(.caption)
                    .foregroundColor(isMine ? Color.vxinBubbleText.opacity(0.8) : .vxinTextSecondary)
                    .lineLimit(1)
            }
            Text("查看 \(record.items.count) 条记录")
                .touliaoText(.caption)
                .foregroundColor(isMine ? Color.vxinBubbleText.opacity(0.7) : .vxinTextSecondary)
                .padding(.top, 2)
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .frame(width: 232, alignment: .leading)
        .background(isMine ? AnyShapeStyle(LinearGradient.vxinBubble) : AnyShapeStyle(Color.vxinSurfaceSecondary))
        .clipShape(RoundedRectangle(cornerRadius: VxinRadius.md))
    }
}

/// 合并转发详情浏览列表（F5）：只读展示 senderName/时间/摘要，不跳转原消息。
private struct MergedForwardDetailSheet: View {
    let title: String
    let items: [MergedForwardItem]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if items.isEmpty {
                    Text("记录内容不可用").foregroundColor(.vxinTextSecondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(items) { item in
                        Group {
                        HStack(alignment: .top, spacing: 8) {
                            TouliaoIcon(TouliaoIcon.messageType(item.type), size: .sm)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(item.senderName.isEmpty ? "成员" : item.senderName)
                                        .touliaoText(.secondary, weight: .bold)
                                    Spacer()
                                    Text(formatChatTime(item.ts))
                                        .touliaoText(.caption).foregroundColor(.vxinTextSecondary)
                                }
                                Text(item.snippet.isEmpty ? "内容不可用" : item.snippet)
                                    .touliaoText(.secondary)
                                    .foregroundColor(.vxinTextSecondary)
                            }
                        }
                        .padding(.vertical, 2)
                        }.listRowBackground(Color.vxinSurface).listRowSeparatorTint(Color.vxinBorder)
                    }
                    .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.vxinSurface)
                }
            }
            .navigationTitle(title.isEmpty ? "聊天记录" : title)
            .navigationBarTitleDisplayMode(.inline)
        .touliaoPage()
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { dismiss() } } }
        }
    }
}
