import SwiftUI

/// 设置首页：把原来摊平在「我的」页里的通知/隐私/外观收拢成独立设置页（对齐母版）。
struct SettingsHomeView: View {
    @State private var cacheBytes: Int64 = 0
    @State private var clearing = false
    @State private var showClearConfirm = false
    @State private var showAbout = false

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                LegalLinks()
                SafetyReportButton(label: "举报与客服 / 我的工单")
                TouliaoSettingSection {
                    NavigationLink(destination: NotificationSettingsView()) {
                        TouliaoSettingRow(icon: "notification", title: "消息通知")
                    }.buttonStyle(.plain)
                    TouliaoSettingDivider()
                    NavigationLink(destination: PrivacySecurityView()) {
                        TouliaoSettingRow(icon: "security", title: "隐私与安全")
                    }.buttonStyle(.plain)
                    TouliaoSettingDivider()
                    NavigationLink(destination: AppearanceSettingsView()) {
                        TouliaoSettingRow(icon: "appearance", title: "外观")
                    }.buttonStyle(.plain)
                    TouliaoSettingDivider()
                    NavigationLink(destination: SessionsView()) {
                        TouliaoSettingRow(icon: "device", title: "登录设备管理")
                    }.buttonStyle(.plain)
                }
                TouliaoSettingSection {
                    Button { showClearConfirm = true } label: {
                        TouliaoSettingRow(icon: "delete", title: "清除缓存", trailing: clearing ? nil : formatBytes(cacheBytes), showsSpinner: clearing)
                    }.buttonStyle(.plain)
                    TouliaoSettingDivider()
                    Button { showAbout = true } label: {
                        TouliaoSettingRow(icon: "info", title: "关于 投聊", trailing: ProfileView.shortVer)
                    }.buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
        }
        .background(Color.vxinBackground.ignoresSafeArea())
        .navigationTitle("设置")
        .navigationBarTitleDisplayMode(.inline)
        .touliaoPage()
        .task { refreshCacheSize() }
        .alert("清除缓存", isPresented: $showClearConfirm) {
            Button("取消", role: .cancel) {}
            Button("清除", role: .destructive) { clearCache() }
        } message: {
            Text("将清除本地图片缓存与离线消息缓存，不影响服务器上的聊天记录。")
        }
        .alert("关于 投聊", isPresented: $showAbout) {
            Button("确定") {}
        } message: {
            Text("版本 \(ProfileView.shortVer) (\(ProfileView.buildNum))")
        }
    }

    /// 真实缓存大小：App Caches 目录（含图片磁盘缓存）实际占用。
    private func refreshCacheSize() {
        DispatchQueue.global(qos: .utility).async {
            let bytes = directorySize(cachesDirectory())
            DispatchQueue.main.async { cacheBytes = bytes }
        }
    }

    /// 真实清缓存：清空 Caches 目录 + 本地离线消息缓存（服务端为真相源，清了安全）。
    private func clearCache() {
        clearing = true
        DispatchQueue.global(qos: .utility).async {
            let dir = cachesDirectory()
            if let items = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) {
                for item in items { try? FileManager.default.removeItem(at: item) }
            }
            MsgCacheStore.shared.clear(nil)
            let bytes = directorySize(dir)
            DispatchQueue.main.async { clearing = false; cacheBytes = bytes }
        }
    }
}

private func cachesDirectory() -> URL {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
}

private func directorySize(_ url: URL) -> Int64 {
    guard let enumerator = FileManager.default.enumerator(at: url, includingPropertiesForKeys: [.fileSizeKey]) else { return 0 }
    var total: Int64 = 0
    for case let fileURL as URL in enumerator {
        if let size = try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize {
            total += Int64(size)
        }
    }
    return total
}

private func formatBytes(_ bytes: Int64) -> String {
    let mb = Double(bytes) / 1024.0 / 1024.0
    return mb < 0.1 ? "0 MB" : String(format: "%.1f MB", mb)
}
