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
                .font(.subheadline.bold())
                .lineLimit(1)
            // 摘要最多 2 条（对齐 Web wc-merged-summary）
            ForEach(Array(record.items.prefix(2).enumerated()), id: \.offset) { _, item in
                Text("\(item.senderName.isEmpty ? "" : "\(item.senderName): ")\(item.snippet)")
                    .font(.caption)
                    .foregroundColor(isMine ? Color.vxinBubbleText.opacity(0.8) : .vxinTextSecondary)
                    .lineLimit(1)
            }
            Text("查看 \(record.items.count) 条记录")
                .font(.caption2)
                .foregroundColor(isMine ? Color.vxinBubbleText.opacity(0.7) : .vxinTextSecondary)
                .padding(.top, 2)
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .frame(width: 232, alignment: .leading)
        .background(isMine ? AnyShapeStyle(LinearGradient.vxinBubble) : AnyShapeStyle(Color(.secondarySystemBackground)))
        .clipShape(RoundedRectangle(cornerRadius: VxinRadius.md))
    }
}

/// 合并转发详情浏览列表（F5）：只读展示 senderName/时间/摘要，不跳转原消息。
private struct MergedForwardDetailSheet: View {
    let title: String
    let items: [MergedForwardItem]
    @Environment(\.dismiss) private var dismiss

    /// 类型图标（对齐 Web typeIcon）
    private func typeIcon(_ type: String) -> String {
        switch type {
        case "text": return "💬"
        case "image": return "🖼"
        case "video": return "🎬"
        case "voice": return "🎤"
        case "file": return "📎"
        case "contact_card", "contact": return "👤"
        case "merged": return "📚"
        default: return "💬"
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if items.isEmpty {
                    Text("记录内容不可用").foregroundColor(.vxinTextSecondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(items) { item in
                        HStack(alignment: .top, spacing: 8) {
                            Text(typeIcon(item.type))
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(item.senderName.isEmpty ? "成员" : item.senderName)
                                        .font(.subheadline.bold())
                                    Spacer()
                                    Text(formatChatTime(item.ts))
                                        .font(.caption2).foregroundColor(.vxinTextSecondary)
                                }
                                Text(item.snippet.isEmpty ? "内容不可用" : item.snippet)
                                    .font(.subheadline)
                                    .foregroundColor(.vxinTextSecondary)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle(title.isEmpty ? "聊天记录" : title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { dismiss() } } }
        }
    }
}
