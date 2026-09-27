import SwiftUI

/// 强制升级：本机构建号（CFBundleVersion）低于后台最低版本（GET /api/config → minVersion.ios）时，
/// 整个 App 只显示升级页，不提供跳过入口。拉取失败视为不强制，不误伤。
enum ForceUpdate {
    /// TestFlight 公开测试链接（见 ios/release-preparation/upload-prepared.py）
    static let updateURL = URL(string: "https://testflight.apple.com/join/JR7seuh6")!

    static func required() async -> Bool {
        struct CfgResp: Decodable {
            struct MinVersion: Decodable { let ios: Int? }
            let minVersion: MinVersion?
        }
        guard let cfg: CfgResp = try? await APIClient.shared.send("api/config", authorized: false),
              let minimum = cfg.minVersion?.ios, minimum > 0,
              let build = Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "") else { return false }
        return build < minimum
    }
}

struct ForceUpdateView: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 12) {
            Text("需要更新")
                .font(.system(size: 22, weight: .semibold))
                .foregroundColor(.vxinText)
            Text("当前版本已停止支持，请更新到最新版本后继续使用。")
                .multilineTextAlignment(.center)
                .foregroundColor(.vxinTextSecondary)
            Button { openURL(ForceUpdate.updateURL) } label: {
                Text("立即更新").frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(.vxinBrand)
            .padding(.top, 20)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
