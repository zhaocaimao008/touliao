import SwiftUI

struct SafetyTarget: Identifiable {
    let type: String
    let targetId: String
    var id: String { type + ":" + targetId }
}
private struct SafetyReportBody: Encodable { let targetType: String; let targetId: String; let reason: String }
private struct SafetyReceipt: Decodable { let id: String; let status: String }
private struct SafetyTicket: Decodable, Identifiable {
    let id: String; let status: String; let reason: String; let resolution: String
}
private struct SafetyTicketPage: Decodable { let items: [SafetyTicket]; let hasMore: Bool }
private func safetyStatus(_ value: String) -> String {
    ["pending":"待受理", "reviewing":"处理中", "resolved":"已处理", "dismissed":"已驳回"][value] ?? value
}
struct SafetyReportButton: View {
    var targetType = "support"
    var targetId = "support"
    var label = "举报"
    @State private var open = false
    var body: some View {
        Button(label) { open = true }
            .sheet(isPresented: $open) { SafetyReportView(target: SafetyTarget(type: targetType, targetId: targetId)) }
    }
}
struct SafetyReportView: View {
    let target: SafetyTarget
    @Environment(\.dismiss) private var dismiss
    @State private var reason = ""
    @State private var receipt = ""
    @State private var error = ""
    @State private var busy = false
    @State private var items: [SafetyTicket] = []
    @State private var offset = 0
    @State private var hasMore = false
    var body: some View {
        NavigationStack {
            Form {
                Section("提交问题") {
                    Text("请说明问题，可在下方查看回复。独立邮箱/电话和处理时限待运营方提供。")
                    TextEditor(text: $reason).frame(minHeight: 90).accessibilityLabel("问题或举报理由")
                    Button(busy ? "提交中…" : "提交") { submit() }
                        .disabled(busy || reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || reason.count > 1000)
                    if !receipt.isEmpty { Text(receipt).textSelection(.enabled) }
                    if !error.isEmpty { Text(error).foregroundColor(.red) }
                }
                Section("我的工单") {
                    Button("刷新状态") { Task { await load(offset) } }
                    ForEach(items) { item in
                        VStack(alignment: .leading) {
                            Text("\(item.id) · \(safetyStatus(item.status))").textSelection(.enabled)
                            Text(item.reason)
                            Text(item.resolution.isEmpty ? "等待管理员处理" : item.resolution)
                        }
                    }
                    Button("上一页") { Task { await load(max(0, offset - 30)) } }.disabled(offset == 0)
                    Button("下一页") { Task { await load(offset + 30) } }.disabled(!hasMore)
                }
            }
            .navigationTitle("举报与客服")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { dismiss() } } }
            .task { await load(0) }
        }
    }
    @MainActor private func load(_ start: Int) async {
        do {
            let page: SafetyTicketPage = try await APIClient.shared.send("api/reports?offset=\(start)&limit=30")
            items = page.items; hasMore = page.hasMore; offset = start; error = ""
        } catch { self.error = error.localizedDescription }
    }
    @MainActor private func submit() {
        let text = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy, !text.isEmpty, text.count <= 1000 else { return }
        busy = true; error = ""
        Task {
            defer { busy = false }
            do {
                let result: SafetyReceipt = try await APIClient.shared.send("api/reports", method: "POST", body: SafetyReportBody(targetType: target.type, targetId: target.targetId, reason: text))
                receipt = "工单 \(result.id)：\(safetyStatus(result.status))"; reason = ""
                await load(0)
            } catch { self.error = error.localizedDescription }
        }
    }
}
