import SwiftUI

@MainActor
final class CallHistoryViewModel: ObservableObject {
    @Published var items: [CallLog] = []
    @Published var loading = true
    @Published var error: String?

    private let repo = ProfileRepository.shared
    private let contactRepo = ContactRepository.shared

    func refresh() async {
        loading = true; error = nil
        do { items = try await repo.callLogs() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "加载通话记录失败" }
        loading = false
    }

    /// 点击通话记录 → 打开对方会话(回拨/继续聊天)
    func openPeerChat(_ c: CallLog) async -> Conversation? {
        guard !c.peerId.isEmpty else { return nil }
        do {
            let id = try await contactRepo.createPrivate(userId: c.peerId)
            var conv = Conversation(id: id, type: "private", name: c.peerName.isEmpty ? "聊天" : c.peerName)
            conv.otherUser = Conversation.OtherUser(id: c.peerId, username: c.peerName)
            return conv
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "打开聊天失败"
            return nil
        }
    }
}

struct CallHistoryView: View {
    @EnvironmentObject private var session: SessionStore
    @StateObject private var vm = CallHistoryViewModel()
    @State private var navTarget: Conversation?

    var body: some View {
        Group {
            if vm.loading && vm.items.isEmpty {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if vm.items.isEmpty {
                Text("暂无通话记录").foregroundColor(.vxinTextSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(vm.items) { c in
                    Button { Task { navTarget = await vm.openPeerChat(c) } } label: { row(c) }
                        .buttonStyle(.plain)
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("通话记录")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: Binding(get: { navTarget != nil }, set: { if !$0 { navTarget = nil } })) {
            if let conv = navTarget {
                ChatView(conversation: conv, myId: session.currentUser?.id ?? "", onOpenGroupInfo: {})
            }
        }
        .toast($vm.error)
        .task { await vm.refresh() }
    }

    @ViewBuilder private func row(_ c: CallLog) -> some View {
        let missed = c.direction == "in" && (c.status == "missed" || c.status == "canceled")
        HStack(spacing: 12) {
            InitialAvatar(name: c.peerName.isEmpty ? "?" : c.peerName, size: 42)
            VStack(alignment: .leading, spacing: 3) {
                Text(c.peerName.isEmpty ? "用户" : c.peerName)
                    .font(.subheadline).fontWeight(.medium)
                    .foregroundColor(missed ? .vxinError : .primary)
                HStack(spacing: 4) {
                    Image(systemName: c.direction == "out" ? "arrow.up.right" : "arrow.down.left")
                        .font(.caption2)
                    Text(subtitle(c)).font(.caption)
                }
                .foregroundColor(missed ? .vxinError : .vxinTextSecondary)
            }
            Spacer()
            Text(formatChatTime(c.createdAt)).font(.caption2).foregroundColor(.vxinTextSecondary)
        }
        .padding(.vertical, 2)
    }

    private func subtitle(_ c: CallLog) -> String {
        let kind = c.type == "video" ? "视频通话" : "语音通话"
        let status = statusLabel(c.status)
        let dur = fmtDuration(c.duration)
        return "\(kind) · \(status)" + (dur.isEmpty ? "" : " · \(dur)")
    }

    private func statusLabel(_ s: String) -> String {
        switch s {
        case "missed": return "未接听"
        case "canceled": return "已取消"
        case "rejected": return "已拒绝"
        case "ongoing": return "通话中"
        default: return "已接通"
        }
    }

    private func fmtDuration(_ s: Int) -> String {
        guard s > 0 else { return "" }
        let m = s / 60, sec = s % 60
        return m > 0 ? "\(m)分\(sec)秒" : "\(sec)秒"
    }
}
