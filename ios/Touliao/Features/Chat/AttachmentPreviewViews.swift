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
    @StateObject private var playback = AttachmentPlayback()
    @State private var saving = false
    @State private var errorMsg: String?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VideoPlayer(player: playback.player)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            MediaPreviewToolbar(title: filename ?? "视频", onDismiss: onDismiss) {
                Button(action: saveVideo) {
                    Label(saving ? "保存中…" : "保存视频", touliaoIcon: "download")
                        .touliaoFont(14).frame(minHeight: 44)
                }
                .disabled(saving)
            }
        }
        .toast($errorMsg)
        .task(id: url) { playback.load(url); playback.player.play() }
        .onDisappear { playback.player.pause() }
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
        ZStack {
            Color(white: 0.12).ignoresSafeArea()
            if let document {
                PdfKitView(document: document)
            } else if let errorMsg {
                Text("无法预览：\(errorMsg)").foregroundColor(.white)
                    .padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView("加载文件…").tint(.white).foregroundColor(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            MediaPreviewToolbar(title: filename ?? "PDF", onDismiss: onDismiss) { EmptyView() }
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
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    TouliaoIcon("fileContent", size: .xl)
                        .foregroundColor(.vxinBrand)
                        .frame(width: 80, height: 80)
                        .background(Color.vxinPrimarySoft)
                        .clipShape(RoundedRectangle(cornerRadius: VxinRadius.card))
                    Text(filename ?? "未知文件").touliaoFont(18, weight: .semibold)
                        .multilineTextAlignment(.center)
                    if let sizeText, !sizeText.isEmpty {
                        Text(sizeText).touliaoFont(14).foregroundColor(.vxinTextSecondary)
                    }
                    Text("该文件格式暂不支持在投聊内直接预览，可以下载保存，或下载后选择用其他应用打开。")
                        .touliaoFont(14).foregroundColor(.vxinTextSecondary)
                        .multilineTextAlignment(.center)
                    VxinGradientButton(title: "用其他应用打开", loading: preparing, action: openWithOtherApp)
                }
                .padding(24)
            }
            .navigationTitle("文件详情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: onDismiss) {
                        TouliaoIcon("close", size: .md).frame(minWidth: 44, minHeight: 44)
                    }.accessibilityLabel("关闭文件")
                }
            }
            .touliaoPage()
            .toast($errorMsg)
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

/// A single player survives SwiftUI updates (including download progress/toasts).
/// This is presentation state only; uploads, authenticated URLs and downloads are unchanged.
final class AttachmentPlayback: ObservableObject {
    let player = AVPlayer()
    private(set) var source: String?

    func load(_ source: String) {
        guard self.source != source, let url = URL(string: source) else { return }
        self.source = source
        player.replaceCurrentItem(with: AVPlayerItem(url: url))
    }
}

struct MediaPreviewToolbar<Actions: View>: View {
    let title: String
    let onDismiss: () -> Void
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onDismiss) {
                TouliaoIcon("close", size: .md).frame(width: 44, height: 44)
            }.accessibilityLabel("关闭预览")
            Text(title).touliaoFont(14).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
            actions()
        }
        .foregroundColor(IconColor.onDark)
        .padding(.horizontal, 12).padding(.vertical, 4)
        .background(Color(white: 0.10))
    }
}
