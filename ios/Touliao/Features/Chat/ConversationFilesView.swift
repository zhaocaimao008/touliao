import SwiftUI
import UIKit
import Kingfisher

// MARK: - 文件聚合 tab（对应后端 type 参数，与 Android FileTab 对齐）

enum FileTab: String, CaseIterable, Identifiable {
    case all = "all"
    case image = "image"
    case video = "video"
    case file = "file"

    var id: String { rawValue }
    var label: String {
        switch self {
        case .all: return "全部"
        case .image: return "图片"
        case .video: return "视频"
        case .file: return "文件"
        }
    }
}

// MARK: - 聊天文件聚合 ViewModel

@MainActor
final class ConversationFilesViewModel: ObservableObject {
    @Published var tab: FileTab = .all
    @Published var items: [ConversationFile] = []
    @Published var loading = false          // 首屏/切 tab 加载
    @Published var loadingMore = false      // 分页加载
    @Published var hasMore = true
    @Published var error: String?

    private let limit = 30
    private let conversationId: String
    private let repo = ChatRepository.shared

    init(conversationId: String) {
        self.conversationId = conversationId
    }

    /// 切换 tab：重置列表并重新加载（切换与当前一致则忽略）
    func switchTab(_ newTab: FileTab) {
        guard newTab != tab else { return }
        tab = newTab
        Task { await loadFirst() }
    }

    /// 首次加载 / 下拉刷新（重置分页）
    func loadFirst() async {
        let requested = tab
        loading = true; error = nil
        defer { loading = false }
        do {
            let resp = try await repo.conversationFiles(conversationId, type: requested.type, offset: 0, limit: limit)
            // 加载期间 tab 可能已切换 → 丢弃过期结果
            guard requested == tab else { return }
            items = resp.items
            hasMore = resp.items.count == limit
        } catch {
            guard requested == tab else { return }
            self.error = (error as? LocalizedError)?.errorDescription ?? "加载失败"
        }
    }

    /// 分页加载下一页（按返回条数判断 hasMore）
    func loadNext() async {
        guard hasMore, !loading, !loadingMore else { return }
        let requested = tab
        loadingMore = true
        defer { loadingMore = false }
        do {
            let resp = try await repo.conversationFiles(conversationId, type: requested.type, offset: items.count, limit: limit)
            guard requested == tab else { return }
            items += resp.items
            hasMore = resp.items.count == limit
        } catch {
            guard requested == tab else { return }
            self.error = (error as? LocalizedError)?.errorDescription ?? "加载更多失败"
        }
    }

    func resolveMediaUrl(_ url: String?) -> String? { MediaUrlResolver.resolve(url) }
}

extension FileTab {
    /// 对应后端 type 参数
    var type: String { rawValue }
}

// MARK: - 聊天文件聚合 View（全屏，仿 MentionsView）

struct ConversationFilesView: View {
    let conversationId: String

    @StateObject private var vm: ConversationFilesViewModel
    @Environment(\.dismiss) private var dismiss

    // 全屏图片预览（点击图片项打开）
    @State private var previewImage: String?
    // 2026-08-29 统一附件系统：视频/PDF/其他文件 App 内预览态
    @State private var videoPreview: (url: String, name: String?)?
    @State private var pdfPreview: (url: String, name: String?)?
    @State private var fileDetails: (url: String, name: String?, size: String?)?

    init(conversationId: String) {
        self.conversationId = conversationId
        _vm = StateObject(wrappedValue: ConversationFilesViewModel(conversationId: conversationId))
    }

    // 图片/视频三列网格布局
    private let gridColumns = [GridItem(.flexible(), spacing: 4),
                               GridItem(.flexible(), spacing: 4),
                               GridItem(.flexible(), spacing: 4)]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // 顶部 tab
                Picker("类型", selection: Binding(
                    get: { vm.tab },
                    set: { vm.switchTab($0) }
                )) {
                    ForEach(FileTab.allCases) { tab in
                        Text(tab.label).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 12).padding(.vertical, 8)

                content
            }
            .navigationTitle("聊天文件")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("关闭") { dismiss() }
                }
            }
        }
        .task { await vm.loadFirst() }
        // 图片全屏预览
        .fullScreenCover(isPresented: Binding(get: { previewImage != nil }, set: { if !$0 { previewImage = nil } })) {
            if let url = previewImage { FilePreviewImageView(url: url) { previewImage = nil } }
        }
        .fullScreenCover(isPresented: Binding(get: { videoPreview != nil }, set: { if !$0 { videoPreview = nil } })) {
            if let v = videoPreview { VideoPlayerOverlay(url: v.url, filename: v.name) { videoPreview = nil } }
        }
        .fullScreenCover(isPresented: Binding(get: { pdfPreview != nil }, set: { if !$0 { pdfPreview = nil } })) {
            if let p = pdfPreview { PdfPreviewOverlay(url: p.url, filename: p.name) { pdfPreview = nil } }
        }
        .fullScreenCover(isPresented: Binding(get: { fileDetails != nil }, set: { if !$0 { fileDetails = nil } })) {
            if let f = fileDetails { FileDetailsOverlay(url: f.url, filename: f.name, sizeText: f.size) { fileDetails = nil } }
        }
    }

    @ViewBuilder private var content: some View {
        if vm.loading && vm.items.isEmpty {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let err = vm.error, vm.items.isEmpty {
            VStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 36)).foregroundColor(.vxinTextSecondary)
                Text(err).foregroundColor(.vxinError)
                Button("重试") { Task { await vm.loadFirst() } }.foregroundColor(.vxinGreen)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if vm.items.isEmpty {
            VStack(spacing: 12) {
                Image(systemName: "folder")
                    .font(.system(size: 48)).foregroundColor(.vxinTextSecondary)
                Text("暂无文件").foregroundColor(.vxinTextSecondary)
                Text("该会话下的图片、视频与文件会在这里汇总")
                    .font(.caption).foregroundColor(.vxinTextSecondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if vm.tab == .file {
            fileList
        } else {
            mediaGrid
        }
    }

    // 文件：单列行（📄图标 + 文件名 + 发送者 + 时间）
    private var fileList: some View {
        List {
            ForEach(vm.items) { file in
                Button { openFile(file) } label: { FileRow(file: file) }
                    .buttonStyle(.plain)
                    .onAppear { loadMoreIfNeeded(file) }
            }
            if vm.loadingMore {
                HStack { Spacer(); ProgressView(); Spacer() }.listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
        .refreshable { await vm.loadFirst() }
    }

    // 图片/视频：三列缩略图网格
    private var mediaGrid: some View {
        ScrollView {
            LazyVGrid(columns: gridColumns, spacing: 4) {
                ForEach(vm.items) { file in
                    MediaGridCell(file: file, resolve: vm.resolveMediaUrl)
                        .onTapGesture { openFile(file) }
                        .onAppear { loadMoreIfNeeded(file) }
                }
            }
            .padding(4)
            if vm.loadingMore {
                ProgressView().padding(.vertical, 12)
            }
        }
        .refreshable { await vm.loadFirst() }
    }

    /// 滚到接近末尾时触发加载更多
    private func loadMoreIfNeeded(_ file: ConversationFile) {
        if file.id == vm.items.last?.id && vm.hasMore {
            Task { await vm.loadNext() }
        }
    }

    /// 打开条目：图片 → 全屏预览；视频 → App内播放；PDF → App内PDFKit预览；
    /// 其余 → 文件详情页(仅下载/分享/用其他应用打开)。此前视频/文件走
    /// UIApplication.shared.open() 直接跳 Safari，是本次要修的根因之一。
    private func openFile(_ file: ConversationFile) {
        guard let resolved = vm.resolveMediaUrl(file.fileUrl) else { return }
        if file.type == "image" {
            previewImage = resolved
        } else if file.type == "video" {
            videoPreview = (resolved, file.content)
        } else if (file.content as NSString).pathExtension.lowercased() == "pdf" {
            pdfPreview = (resolved, file.content)
        } else {
            fileDetails = (resolved, file.content, humanFileSize(file.fileSize))
        }
    }
}

// MARK: - 文件行（📄 + 文件名 + 发送者 + 时间）

private struct FileRow: View {
    let file: ConversationFile

    var body: some View {
        HStack(spacing: 12) {
            Text("📄").font(.system(size: 28))
            VStack(alignment: .leading, spacing: 3) {
                Text(file.displayName)
                    .font(.body).lineLimit(1)
                HStack(spacing: 8) {
                    Text(file.senderName.isEmpty ? "某人" : file.senderName)
                        .font(.caption2).foregroundColor(.vxinTextSecondary).lineLimit(1)
                    Spacer()
                    Text(formatChatTime(file.createdAt))
                        .font(.caption2).foregroundColor(.vxinTextSecondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - 图片/视频网格缩略图（视频叠加 ▶ 角标）

private struct MediaGridCell: View {
    let file: ConversationFile
    let resolve: (String?) -> String?

    var body: some View {
        ZStack {
            Color.gray.opacity(0.12)
            KFImage(source: MediaUrlResolver.kfSource(resolved: resolve(file.fileUrl)))
                .resizable()
                .scaledToFill()
            // 视频角标：半透明播放标识
            if file.type == "video" {
                Color.black.opacity(0.18)
                Image(systemName: "play.circle.fill")
                    .font(.system(size: 30)).foregroundColor(.white.opacity(0.9))
            }
        }
        .aspectRatio(1, contentMode: .fill)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: VxinRadius.sm))
        .contentShape(Rectangle())
    }
}

// MARK: - 图片全屏预览（点击关闭，双指缩放）

private struct FilePreviewImageView: View {
    let url: String
    var onClose: () -> Void
    @State private var scale: CGFloat = 1

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            KFImage(source: MediaUrlResolver.kfSource(resolved: url))
                .resizable().scaledToFit()
                .scaleEffect(scale)
                .gesture(
                    MagnificationGesture()
                        .onChanged { scale = max(1, min($0, 4)) }
                        .onEnded { _ in if scale < 1 { scale = 1 } }
                )
                .onTapGesture { onClose() }
            VStack {
                HStack {
                    Button { onClose() } label: {
                        Image(systemName: "xmark").foregroundColor(.white).padding()
                    }
                    .accessibilityLabel("关闭")
                    Spacer()
                }
                Spacer()
            }
        }
    }
}

