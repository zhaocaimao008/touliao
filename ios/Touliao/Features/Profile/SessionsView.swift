import SwiftUI

@MainActor
final class SessionsViewModel: ObservableObject {
    @Published var loading = true
    @Published var sessions: [DeviceSession] = []
    @Published var error: String?
    @Published var message: String?

    private let repo = AuthRepository.shared

    func load() async {
        loading = true; error = nil
        do { sessions = try await repo.sessions() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "加载失败" }
        loading = false
    }

    func kick(_ s: DeviceSession) {
        guard !s.current else { return }
        Task {
            do {
                try await repo.deleteSession(s.id)
                sessions.removeAll { $0.id == s.id }
                message = "已下线该设备"
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "操作失败" }
        }
    }

    func kickOthers() {
        Task {
            do {
                try await repo.deleteOtherSessions()
                sessions = sessions.filter { $0.current }
                message = "已退出其它设备"
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "操作失败" }
        }
    }
}

struct SessionsView: View {
    @StateObject private var vm = SessionsViewModel()
    @State private var kickTarget: DeviceSession?
    @State private var showKickOthers = false

    var body: some View {
        List {
            if vm.loading {
                HStack { Spacer(); ProgressView(); Spacer() }
            } else if vm.sessions.isEmpty {
                Text("暂无登录设备").foregroundColor(.vxinTextSecondary)
            } else {
                ForEach(vm.sessions) { s in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 4) {
                                Text(s.device.isEmpty ? (s.platform.isEmpty ? "未知设备" : s.platform) : s.device)
                                if s.current { Text("· 当前设备").font(.caption).foregroundColor(.vxinGreen) }
                            }
                            Text((s.ip.isEmpty ? "" : "IP \(s.ip) · ") + "最近活跃 " + formatTime(s.lastSeen))
                                .font(.caption).foregroundColor(.vxinTextSecondary)
                        }
                        Spacer()
                        if !s.current { Button("下线", role: .destructive) { kickTarget = s } }
                    }
                }
            }
        }
        .navigationTitle("登录设备管理")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if vm.sessions.contains(where: { !$0.current }) {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("退出其它设备") { showKickOthers = true }
                }
            }
        }
        .task { await vm.load() }
        .alert("下线该设备", isPresented: .constant(kickTarget != nil)) {
            Button("取消", role: .cancel) { kickTarget = nil }
            Button("确认", role: .destructive) { if let t = kickTarget { vm.kick(t) }; kickTarget = nil }
        } message: { Text("确认让「\(kickTarget?.device ?? "该设备")」下线？该设备需重新登录。") }
        .alert("退出其它设备", isPresented: $showKickOthers) {
            Button("取消", role: .cancel) {}
            Button("确认", role: .destructive) { vm.kickOthers() }
        } message: { Text("确认退出除当前设备外的所有登录？") }
    }

    private func formatTime(_ epoch: Double) -> String {
        guard epoch > 0 else { return "" }
        let f = DateFormatter(); f.dateFormat = "MM-dd HH:mm"
        return f.string(from: Date(timeIntervalSince1970: epoch))
    }
}
