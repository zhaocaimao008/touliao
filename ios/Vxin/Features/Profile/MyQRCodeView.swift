import SwiftUI

/// 我的二维码：拉取服务端 PNG（需 Bearer）展示。
struct MyQRCodeView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var image: UIImage?
    @State private var loading = true
    @State private var error: String?

    private let repo = ProfileRepository.shared

    var body: some View {
        VStack(spacing: 16) {
            if let user = session.currentUser {
                InitialAvatar(name: user.username.isEmpty ? "?" : user.username, size: 64)
                Text(user.username).font(.headline)
                if !user.wechatId.isEmpty {
                    Text("v信号: \(user.wechatId)").font(.footnote).foregroundColor(.vxinTextSecondary)
                }
            }

            Spacer().frame(height: 8)

            if loading {
                ProgressView()
            } else if let image {
                Image(uiImage: image)
                    .resizable().interpolation(.none)
                    .scaledToFit()
                    .frame(width: 240, height: 240)
            } else {
                Text(error ?? "二维码加载失败").foregroundColor(.vxinTextSecondary)
            }

            Text("扫一扫上面的二维码，添加我为好友")
                .font(.footnote).foregroundColor(.vxinTextSecondary)
            Spacer()
        }
        .padding(24)
        .navigationTitle("我的二维码")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        loading = true; error = nil
        do {
            let data = try await repo.qrcodeData()
            image = UIImage(data: data)
            if image == nil { error = "二维码解析失败" }
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "二维码加载失败"
        }
        loading = false
    }
}
