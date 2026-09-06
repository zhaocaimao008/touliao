import SwiftUI
import PhotosUI
import AVFoundation
import UniformTypeIdentifiers

@MainActor
final class MomentComposeViewModel: ObservableObject {
    @Published var content = ""
    @Published var images: [UIImage] = []
    /// 媒体模式（F5 朋友圈视频）：images | video，互斥——切换即清另一侧
    @Published var mediaMode = "images"
    /// 已选视频（F5）：本地暂存文件（PickedVideoFile 拷贝到 Caches/touliao-upload），
    /// 上传走磁盘流式路径，不整体读进内存；videoThumb 为本地首帧缩略图。
    @Published var videoURL: URL?
    @Published var videoName = ""
    @Published var videoThumb: UIImage?
    @Published var visibility = "all"          // all | friends | private | include | exclude
    @Published var visibleTo: Set<String> = [] // include/exclude 选中的好友 id
    @Published var friends: [Contact] = []
    @Published var publishing = false
    @Published var error: String?

    private let repo = MomentRepository.shared

    func ensureFriends() {
        guard friends.isEmpty else { return }
        Task { friends = (try? await ContactRepository.shared.contacts()) ?? [] }
    }

    func toggleFriend(_ id: String) {
        if visibleTo.contains(id) { visibleTo.remove(id) } else { visibleTo.insert(id) }
    }

    /// 切换媒体模式：换到 video 清图片，换回 images 清视频（对齐 Web changeMediaMode）
    func switchMediaMode(_ mode: String) {
        guard mode != mediaMode else { return }
        if mode == "video" { images = [] } else { clearVideo() }
        mediaMode = mode
    }

    func clearVideo() {
        if let url = videoURL { PickedVideoCleanup.removeFile(url) }
        videoURL = nil; videoName = ""; videoThumb = nil
    }

    /// 发布前置校验（对齐 Web validateMomentVideo：0 字节/超 200MB 拒绝）
    static func validateVideo(_ url: URL) -> String? {
        guard let sizeAttr = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = sizeAttr[.size] as? Int64 else { return "视频文件读取失败" }
        if size == 0 { return "视频文件为空，请重新选择" }
        if size > 200 * 1024 * 1024 {
            return "视频超过200MB限制(当前\(ByteCountFormatter.string(fromByteCount: size, countStyle: .file)))，请选择更小的视频"
        }
        return nil
    }

    func publish(_ onDone: @escaping () -> Void) {
        let hasMedia = mediaMode == "video" ? videoURL != nil : !images.isEmpty
        if content.trimmingCharacters(in: .whitespaces).isEmpty && !hasMedia {
            error = "请输入内容或选择图片"; return
        }
        if visibility == "include" && visibleTo.isEmpty {
            error = "请选择至少一位可见的好友"; return
        }
        guard !publishing else { return }
        let visList = (visibility == "include" || visibility == "exclude") ? Array(visibleTo) : []
        publishing = true; error = nil
        Task {
            do {
                // 视频模式：先传 /api/moments/video 拿 URL，再以 video 字段发布（与 images 互斥）
                var videoUrl: String?
                if mediaMode == "video", let url = videoURL {
                    let ext = url.pathExtension.lowercased()
                    let mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? "video/mp4"
                    videoUrl = try await repo.uploadVideo(
                        fileURL: url,
                        fileName: videoName.isEmpty ? "video_\(Int(Date().timeIntervalSince1970)).\(ext.isEmpty ? "mp4" : ext)" : videoName,
                        mimeType: mime
                    )
                }
                var urls: [String] = []
                if mediaMode != "video" && !images.isEmpty {
                    let datas = images.compactMap { img -> (Data, String)? in
                        guard let d = img.jpegData(compressionQuality: 0.85) else { return nil }
                        return (d, "moment.jpg")
                    }
                    urls = try await repo.uploadImages(datas)
                }
                _ = try await repo.create(content: content.trimmingCharacters(in: .whitespacesAndNewlines),
                                          images: urls, visibility: visibility, visibleTo: visList,
                                          video: videoUrl, cover: nil)
                clearVideo()   // 上传完成即清理本地暂存，防 Caches 积累
                publishing = false
                onDone()
            } catch {
                publishing = false
                self.error = (error as? LocalizedError)?.errorDescription ?? "发布失败"
            }
        }
    }
}

struct MomentComposeView: View {
    var onPublished: () -> Void
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm = MomentComposeViewModel()
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var videoItem: PhotosPickerItem?
    @State private var showFriendPicker = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("这一刻的想法…", text: $vm.content, axis: .vertical).lineLimit(3...8)
                }
                Section {
                    // 媒体模式切换（F5）：图片/视频互斥，对齐 Web radiogroup
                    Picker("媒体类型", selection: Binding(
                        get: { vm.mediaMode },
                        set: { vm.switchMediaMode($0) }
                    )) {
                        Text("图片").tag("images")
                        Text("视频").tag("video")
                    }
                    .pickerStyle(.segmented)

                    if vm.mediaMode == "images" {
                        if !vm.images.isEmpty {
                            ScrollView(.horizontal) {
                                HStack {
                                    ForEach(Array(vm.images.enumerated()), id: \.offset) { _, img in
                                        Image(uiImage: img).resizable().scaledToFill()
                                            .frame(width: 72, height: 72).clipShape(RoundedRectangle(cornerRadius: VxinRadius.sm))
                                    }
                                }
                            }
                        }
                        PhotosPicker(selection: $pickerItems, maxSelectionCount: 9, matching: .images) {
                            Label("添加图片", systemImage: "photo.on.rectangle")
                        }
                    } else {
                        if let url = vm.videoURL {
                            // 已选视频：本地首帧缩略图 + 播放角标 + 移除按钮
                            ZStack(alignment: .topTrailing) {
                                Group {
                                    if let thumb = vm.videoThumb {
                                        Image(uiImage: thumb).resizable().scaledToFill()
                                    } else {
                                        Color.black.opacity(0.08)
                                    }
                                }
                                .frame(width: 160, height: 120)
                                .clipShape(RoundedRectangle(cornerRadius: VxinRadius.sm))
                                .overlay {
                                    Image(systemName: "play.circle.fill")
                                        .font(.system(size: 30))
                                        .foregroundColor(.white)
                                        .shadow(color: .black.opacity(0.35), radius: 3)
                                }
                                Button { vm.clearVideo() } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.title3)
                                        .foregroundColor(.white)
                                        .shadow(color: .black.opacity(0.4), radius: 2)
                                }
                                .padding(6)
                                .accessibilityLabel("移除视频")
                            }
                            Text(url.lastPathComponent).font(.caption).foregroundColor(.vxinTextSecondary).lineLimit(1)
                        } else {
                            // 选视频：FileRepresentation 落盘（不整体进内存），iCloud 视频系统自动下载
                            PhotosPicker(selection: $videoItem, matching: .videos) {
                                Label("选择视频", systemImage: "video")
                            }
                        }
                        Text("视频与图片不能同时发布，单个视频不超过 200MB。")
                            .font(.caption).foregroundColor(.vxinTextSecondary)
                    }
                }
                Section("谁可以看") {
                    Picker("可见性", selection: $vm.visibility) {
                        Text("公开").tag("all")
                        Text("好友").tag("friends")
                        Text("私密").tag("private")
                        Text("部分可见").tag("include")
                        Text("不给谁看").tag("exclude")
                    }.pickerStyle(.menu)
                    if vm.visibility == "include" || vm.visibility == "exclude" {
                        Button {
                            vm.ensureFriends(); showFriendPicker = true
                        } label: {
                            HStack {
                                Text(vm.visibility == "include" ? "选择可见好友" : "选择不给谁看")
                                Spacer()
                                Text("\(vm.visibleTo.count) 人").foregroundColor(.vxinTextSecondary)
                            }
                        }
                    }
                }
                if let error = vm.error {
                    Text(error).foregroundColor(.vxinError).font(.footnote)
                }
            }
            .sheet(isPresented: $showFriendPicker) {
                NavigationStack {
                    List(vm.friends) { f in
                        Button { vm.toggleFriend(f.id) } label: {
                            HStack {
                                Image(systemName: vm.visibleTo.contains(f.id) ? "checkmark.circle.fill" : "circle").foregroundColor(.vxinGreen)
                                InitialAvatar(name: f.displayName.isEmpty ? "?" : f.displayName, size: 32)
                                Text(f.displayName.isEmpty ? "用户" : f.displayName).foregroundColor(.primary).lineLimit(1)
                            }
                        }
                    }
                    .navigationTitle(vm.visibility == "include" ? "选择可见好友" : "选择不给谁看")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { showFriendPicker = false } } }
                    .overlay { if vm.friends.isEmpty { Text("暂无好友").foregroundColor(.vxinTextSecondary) } }
                }
            }
            .navigationTitle("发表").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { vm.clearVideo(); dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(vm.publishing ? "发布中…" : "发表") { vm.publish { onPublished() } }
                        .disabled(vm.publishing || (vm.content.trimmingCharacters(in: .whitespaces).isEmpty && vm.images.isEmpty && vm.videoURL == nil))
                }
            }
            .onChange(of: pickerItems) { items in
                Task {
                    var imgs: [UIImage] = []
                    for item in items {
                        if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) { imgs.append(img) }
                    }
                    vm.images = imgs
                }
            }
            .onChange(of: videoItem) { item in
                guard let item else { return }
                Task {
                    defer { videoItem = nil }
                    // 与聊天视频发送同款路径：FileRepresentation 拿稳定磁盘文件 + 首帧缩略图
                    guard let picked = try? await item.loadTransferable(type: PickedVideoFile.self) else {
                        vm.error = "无法读取所选视频，请重试或更换一个视频"
                        return
                    }
                    if let validationError = MomentComposeViewModel.validateVideo(picked.url) {
                        vm.error = validationError
                        PickedVideoCleanup.removeFile(picked.url)
                        return
                    }
                    PickedVideoCleanup.cleanupOldFiles()
                    vm.clearVideo()
                    vm.videoURL = picked.url
                    vm.videoName = picked.suggestedFileName
                    vm.videoThumb = Self.videoThumbnail(url: picked.url)
                }
            }
        }
    }

    /// 本地生成视频首帧缩略图（与 ChatView.handleVideo 同实现；取不到帧不影响发布流程）
    private static func videoThumbnail(url: URL) -> UIImage? {
        let asset = AVURLAsset(url: url)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 480, height: 480)
        guard let cgImage = try? generator.copyCGImage(at: CMTime(seconds: 0.1, preferredTimescale: 600), actualTime: nil) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
