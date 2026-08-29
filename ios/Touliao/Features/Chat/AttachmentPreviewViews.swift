import SwiftUI
import AVKit
import PDFKit

/// 全屏视频播放：SwiftUI 自带 AVKit.VideoPlayer，内置播放/暂停/进度条/全屏，App 内播放
/// 不跳 Safari。url 已带 ?token= 鉴权（见 MediaUrlResolver），AVPlayer 直接用带参数的完整
/// URL 即可播放，服务端支持 Range 即可流式播放，不需要先整个下载。
struct VideoPlayerOverlay: View {
    let url: String
    let filename: String?
    let onDismiss: () -> Void
    @State private var saving = false
    @State private var errorMsg: String?

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            if let playerUrl = URL(string: url) {
                VideoPlayer(player: AVPlayer(url: playerUrl))
                    .ignoresSafeArea()
            }
            HStack {
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .foregroundColor(.white)
                        .padding(10)
                        .background(Color.black.opacity(0.4))
                        .clipShape(Circle())
                }
                Spacer()
                Button(action: saveVideo) {
                    Text(saving ? "保存中…" : "保存视频")
                        .font(.footnote)
                        .foregroundColor(.white)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(Color.black.opacity(0.4))
                        .clipShape(Capsule())
                }
                .disabled(saving)
            }
            .padding(.top, 50)
            .padding(.horizontal, 16)
            if let errorMsg {
                Text(errorMsg).foregroundColor(.white).font(.footnote)
                    .padding(8).background(Color.black.opacity(0.6)).cornerRadius(8)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .padding(.bottom, 40)
            }
        }
    }

    private func saveVideo() {
        saving = true
        Task {
            do {
                try await ImageSaver.saveVideoToPhotos(rawUrl: url)
                await MainActor.run { saving = false }
            } catch {
                await MainActor.run {
                    saving = false
                    errorMsg = (error as? LocalizedError)?.errorDescription ?? "保存失败"
                }
            }
        }
    }
}

/// PDF App 内预览：系统自带 PDFKit（iOS 11+，全程离线本地渲染，不经任何第三方转换服务），
/// 内置分页/滚动/缩放。先用 FileShareHelper 下载到本地临时文件（PDFKit 需要本地 URL/Data，
/// 不直接支持网络流），再用 PDFView 展示。
struct PdfPreviewOverlay: View {
    let url: String
    let filename: String?
    let onDismiss: () -> Void
    @State private var document: PDFDocument?
    @State private var errorMsg: String?

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color(white: 0.32).ignoresSafeArea()
            if let document {
                PdfKitView(document: document).ignoresSafeArea()
            } else if let errorMsg {
                Text("无法预览：\(errorMsg)").foregroundColor(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView().tint(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .foregroundColor(.white)
                    .padding(10)
                    .background(Color.black.opacity(0.4))
                    .clipShape(Circle())
            }
            .padding(.top, 50)
            .padding(.leading, 16)
        }
        .task { await load() }
    }

    private func load() async {
        do {
            let localUrl = try await FileShareHelper.prepareShareFile(rawUrl: url, filename: filename, isImage: false)
            let doc = PDFDocument(url: localUrl)
            await MainActor.run {
                if let doc { document = doc } else { errorMsg = "PDF 解析失败" }
            }
        } catch {
            await MainActor.run { errorMsg = (error as? LocalizedError)?.errorDescription ?? "加载失败" }
        }
    }
}

private struct PdfKitView: UIViewRepresentable {
    let document: PDFDocument
    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.document = document
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.backgroundColor = .darkGray
        return view
    }
    func updateUIView(_ uiView: PDFView, context: Context) {
        if uiView.document !== document { uiView.document = document }
    }
}

/// 不支持 App 内预览的格式（旧版 doc/ppt 二进制、zip/rar 等压缩包）落到这个"文件详情页"——
/// 只显示信息 + 下载/分享/用其他应用打开，绝不自动跳系统。"用其他应用打开"是用户主动选择
/// 的动作，点了才会拉起系统分享/打开面板。
struct FileDetailsOverlay: View {
    let url: String
    let filename: String?
    let sizeText: String?
    let onDismiss: () -> Void
    @State private var preparing = false
    @State private var shareUrl: URL?
    @State private var errorMsg: String?

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.opacity(0.92).ignoresSafeArea()
            VStack(spacing: 16) {
                RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.15))
                    .frame(width: 64, height: 64)
                    .overlay(Text("FILE").font(.caption).foregroundColor(.white))
                Text(filename ?? "未知文件").foregroundColor(.white).multilineTextAlignment(.center)
                if let sizeText, !sizeText.isEmpty {
                    Text(sizeText).font(.footnote).foregroundColor(.white.opacity(0.6))
                }
                Text("该文件格式暂不支持在投聊内直接预览，可以下载保存，或下载后选择用其他应用打开。")
                    .font(.footnote).foregroundColor(.white.opacity(0.6))
                    .multilineTextAlignment(.center).padding(.horizontal, 32)
                HStack(spacing: 12) {
                    Button(action: openWithOtherApp) {
                        Text(preparing ? "准备中…" : "用其他应用打开")
                            .foregroundColor(.white)
                            .padding(.horizontal, 18).padding(.vertical, 10)
                            .background(Color.white.opacity(0.2)).clipShape(Capsule())
                    }
                    .disabled(preparing)
                }
                if let errorMsg { Text(errorMsg).font(.footnote).foregroundColor(.red) }
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .foregroundColor(.white)
                    .padding(10)
                    .background(Color.black.opacity(0.4))
                    .clipShape(Circle())
            }
            .padding(.top, 50)
            .padding(.leading, 16)
        }
        .sheet(isPresented: Binding(get: { shareUrl != nil }, set: { if !$0 { shareUrl = nil } })) {
            if let shareUrl { ActivityShareSheet(items: [shareUrl]) }
        }
    }

    // "用其他应用打开"：用户主动选择的动作，此时才下载 + 拉起系统分享/打开面板
    // （UIActivityViewController 的"用其他App打开"选项即系统标准的 Open In... 交互）。
    private func openWithOtherApp() {
        preparing = true
        Task {
            do {
                let local = try await FileShareHelper.prepareShareFile(rawUrl: url, filename: filename, isImage: false)
                await MainActor.run { preparing = false; shareUrl = local }
            } catch {
                await MainActor.run {
                    preparing = false
                    errorMsg = (error as? LocalizedError)?.errorDescription ?? "下载失败"
                }
            }
        }
    }
}

private struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
