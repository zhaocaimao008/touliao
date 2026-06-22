import SwiftUI

/// 群聊二维码 + 邀请链接。
struct GroupQrView: View {
    let conversationId: String
    @State private var qr: GroupQr?
    @State private var loading = true
    @State private var error: String?
    @State private var copied = false

    private let repo = GroupRepository.shared

    var body: some View {
        VStack(spacing: 16) {
            if loading {
                ProgressView()
            } else if let qr, let image = decodeDataUrl(qr.qrCode) {
                Image(uiImage: image)
                    .resizable().interpolation(.none).scaledToFit()
                    .frame(width: 240, height: 240)
                Text("扫一扫上面的二维码，加入群聊")
                    .font(.footnote).foregroundColor(.vxinTextSecondary)
                Spacer().frame(height: 12)
                Text(qr.url).font(.footnote).foregroundColor(.vxinTextSecondary)
                    .multilineTextAlignment(.center)
                Button {
                    UIPasteboard.general.string = qr.url
                    copied = true
                } label: {
                    Text(copied ? "已复制" : "复制邀请链接").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).tint(.vxinGreen)
                Text("链接 7 天内有效").font(.caption2).foregroundColor(.vxinTextSecondary)
            } else {
                Text(error ?? "二维码加载失败").foregroundColor(.vxinTextSecondary)
            }
            Spacer()
        }
        .padding(24)
        .navigationTitle("群聊二维码")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        loading = true; error = nil
        do { qr = try await repo.qrCode(conversationId) }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "二维码加载失败" }
        loading = false
    }

    private func decodeDataUrl(_ dataUrl: String) -> UIImage? {
        guard let range = dataUrl.range(of: "base64,") else { return nil }
        let b64 = String(dataUrl[range.upperBound...])
        guard let data = Data(base64Encoded: b64) else { return nil }
        return UIImage(data: data)
    }
}
