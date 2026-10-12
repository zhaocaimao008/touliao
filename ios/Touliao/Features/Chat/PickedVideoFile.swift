import Foundation
import UIKit
import CoreTransferable
import UniformTypeIdentifiers
import AVFoundation

/// 2026-08-29 iOS视频发送修复新增：PhotosPickerItem 选中视频后，用 FileRepresentation
/// （而非 Data.self）拿到系统临时文件，再流式拷贝到投聊自己的目录，得到稳定可读路径。
/// 全程不把视频内容读进 Swift Data 常驻内存——FileRepresentation 本身就是"文件到文件"的
/// 系统级拷贝；下面 importing 闭包里我们再拷一次到自己的目录（用 FileManager 整文件拷贝，
/// 系统层面同样走的是文件系统调用，不经用户态内存缓冲），避免依赖 picker 返回的临时 URL
/// （该 URL 生命周期不稳定，picker 关闭后可能被系统提前清理）。
/// iCloud 视频：PhotosPickerItem 的 Transferable 传输过程由系统负责在需要时从 iCloud 下载，
/// 这里不用额外处理，只是可能耗时较久（VideoPreparation 会显示"正在读取视频…"）。
///
/// 2026-08-29 真机复现根因：staging 目录曾放在 `FileManager.default.temporaryDirectory`，
/// 真机报错精确到"文件不存在"(而非空/读取权限问题)——系统 tmp 目录在 App 被系统挂起时
/// (呈现 PhotosPicker 系统选择器期间，宿主 App 常被短暂 suspend)可能被系统直接清空，
/// Apple 官方文档对此有明确说明。改用 Caches 目录：同样是 App 沙盒内、系统不会因为
/// App 短暂挂起就清空，只在磁盘空间紧张时才可能清理，足够覆盖"选完立刻上传"这个窗口期。
///
/// 2026-10-12（8.1.41）：这里只负责拷贝，不再在 loadTransferable 里转码——转码挪到
/// VideoPreparation，由界面显示进度、可取消、有后台任务保护。PhotosPicker 改用
/// preferredItemEncoding: .current 拿原片，只由我们自己导出一次（之前 .compatible 先让系统转一遍
/// H.264，4K 原片再被我们按 1080p 重编码一遍，等于转两次且全程无进度）。
struct PickedVideoFile: Transferable {
    let url: URL
    let suggestedFileName: String

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { file in
            SentTransferredFile(file.url)
        } importing: { received in
            let ext = received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension
            let destDir = PickedVideoCleanup.stagingDir
            let dest = destDir.appendingPathComponent("video_\(UUID().uuidString).\(ext)")
            // 整文件系统级拷贝（FileManager.copyItem 走 syscall，不经用户态Data缓冲），
            // 得到一份投聊自己管理生命周期的稳定文件，picker 关闭也不受影响。
            try FileManager.default.copyItem(at: received.file, to: dest)
            // 2026-08-29 真机复现真正根因：copyItem 会保留源文件的修改时间——也就是这份拷贝的
            // contentModificationDate 是"视频原始拍摄/最后修改时间"，不是"刚拷贝完的现在"。
            // cleanupOldFiles()（清理超过1小时的旧staging文件）会把这份刚拷贝、还没来得及被上传
            // 读取的文件当成"旧文件"立刻删掉。这里显式把拷贝的修改时间重置为"现在"，让
            // cleanupOldFiles 的"超过1小时"判断真正衡量的是"这份staging拷贝放了多久"。
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: dest.path)

            // 2026-08-29新增：copyItem 成功不代表内容非空——iCloud视频等场景下，系统给的
            // received.file 理论上应已完整落盘，但先前排查中不能排除偶发"文件存在但内容还没
            // 完全就绪"的竞态。这里做一次有界重试(最多3次、每次200ms)，比在上传阶段才发现
            // 空文件更早拦截，且能明确区分"源头本来就空"和"上传链路的bug"。
            var size = (try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? Int64) ?? 0
            var attempt = 0
            while (size ?? 0) == 0 && attempt < 3 {
                try? await Task.sleep(nanoseconds: 200_000_000)
                size = (try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? Int64) ?? 0
                attempt += 1
            }
            if (size ?? 0) == 0 {
                try? FileManager.default.removeItem(at: dest)
                throw CocoaError(.fileReadCorruptFile)
            }
            return Self(url: dest, suggestedFileName: "video_\(Int(Date().timeIntervalSince1970)).\(ext)")
        }
    }
}

/// 2026-10-12新增：把选中的视频导出成 H.264/AAC mp4（shouldOptimizeForNetworkUse = faststart，
/// 接收端边下边播）。只导出一次：
/// - 已是 H.264 且长边 ≤ 1920 → Passthrough 只重封装(不重编码、不掉画质、很快)；
/// - 长边 > 1920(4K 等，不论 H.264/HEVC) → 1920x1080 预设重编码一次(H.264)；
/// - 其余(HEVC/ProRes 等 ≤ 1080p) → HighestQuality 预设重编码一次(H.264，不放大分辨率)。
/// 任何失败返回 nil，调用方回退上传原文件（保证：上传的要么是 H.264/AAC mp4，要么是原片）。
enum PickedVideoTranscoder {
    /// 纯函数，单测覆盖：按视频轨编码与尺寸选导出预设。
    static func presetName(isH264: Bool, longEdge: CGFloat) -> String {
        if longEdge > 1920 { return AVAssetExportPreset1920x1080 }
        return isH264 ? AVAssetExportPresetPassthrough : AVAssetExportPresetHighestQuality
    }

    /// 与后端 MAX_UPLOAD_BYTES 默认值一致(200MB)；聊天发送前的前置校验同用这个值。
    static let maxUploadBytes: Int64 = 200 * 1024 * 1024

    /// 纯函数，单测覆盖：HEVC 转 H.264 体积常变大 1.5~2 倍。导出结果超过上传上限、而原片本身没超时，
    /// 改传原片——不能让 8.1.40 能发的视频因为转码反而被"超过200MB"拒掉。
    static func shouldKeepSource(sourceBytes: Int64, exportedBytes: Int64, limit: Int64 = maxUploadBytes) -> Bool {
        exportedBytes > limit && sourceBytes > 0 && sourceBytes <= limit
    }

    static func fileSize(_ url: URL) -> Int64 {
        ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.int64Value ?? 0
    }

    /// 导出成功返回新 mp4 并删除源文件；失败/无视频轨、或导出后超限而原片不超限时返回原文件；
    /// 被取消返回 nil（源文件已删除）。
    static func prepareForUpload(_ picked: PickedVideoFile,
                                 progress: @escaping @Sendable @MainActor (Double) -> Void) async -> PickedVideoFile? {
        let result = await exportCompatibleMP4(from: picked.url, progress: progress)
        if Task.isCancelled {
            if let url = result { PickedVideoCleanup.removeFile(url) }
            PickedVideoCleanup.removeFile(picked.url)
            return nil
        }
        guard let mp4 = result else { return picked }
        // 先确认导出结果可用，再删原片
        if shouldKeepSource(sourceBytes: fileSize(picked.url), exportedBytes: fileSize(mp4)) {
            print("[Video] 转码后超过上传上限而原片未超，改传原片")
            PickedVideoCleanup.removeFile(mp4)
            return picked
        }
        PickedVideoCleanup.removeFile(picked.url)
        return PickedVideoFile(url: mp4, suggestedFileName: "video_\(Int(Date().timeIntervalSince1970)).mp4")
    }

    static func exportCompatibleMP4(from source: URL,
                                    progress: @escaping @Sendable @MainActor (Double) -> Void) async -> URL? {
        let asset = AVURLAsset(url: source)
        guard let info = await videoInfo(asset) else { return nil }
        let preset = presetName(isH264: info.isH264, longEdge: info.longEdge)
        // 切后台时争取执行时间：Passthrough 通常能在后台跑完；重编码依赖硬件编码器，
        // 后台可能被系统打断(AVError.operationInterrupted)，那就等回到前台再导出一次。
        // 每次尝试各自申请后台任务：上一次的令牌可能已过期被系统收回，重试不能裸跑。
        var output: URL?
        for attempt in 0..<2 {
            let background = await BackgroundTaskToken.begin(name: "touliao-video-export")
            let outcome = await runExport(asset: asset, preset: preset, progress: progress)
            await background.end()
            if case .done(let url) = outcome { output = url; break }
            guard case .failed(let interrupted) = outcome, attempt == 0, !Task.isCancelled else { break }
            let inBackground = await MainActor.run { UIApplication.shared.applicationState != .active }
            guard interrupted || inBackground, await waitUntilActive() else { break }
            print("[Video] 导出被切后台打断，回到前台后重试一次")
        }
        return output
    }

    private struct VideoInfo { let isH264: Bool; let longEdge: CGFloat }

    /// 读不到视频轨(纯音频/损坏)返回 nil → 不导出，按原文件上传。
    private static func videoInfo(_ asset: AVURLAsset) async -> VideoInfo? {
        guard let track = try? await asset.loadTracks(withMediaType: .video).first,
              let loaded = try? await track.load(.formatDescriptions, .naturalSize) else { return nil }
        let isH264 = loaded.0.contains { CMFormatDescriptionGetMediaSubType($0) == kCMVideoCodecType_H264 }
        return VideoInfo(isH264: isH264, longEdge: max(abs(loaded.1.width), abs(loaded.1.height)))
    }

    private enum ExportOutcome { case done(URL), cancelled, failed(interrupted: Bool) }

    /// AVAssetExportSession 不是 Sendable；只在这里持有，跨任务只通过这个盒子访问它的线程安全 API
    /// (progress / cancelExport / exportAsynchronously 都可在任意线程调用)。
    private final class SessionBox: @unchecked Sendable {
        let session: AVAssetExportSession
        init(_ session: AVAssetExportSession) { self.session = session }
    }

    private static func runExport(asset: AVURLAsset, preset: String,
                                  progress: @escaping @Sendable @MainActor (Double) -> Void) async -> ExportOutcome {
        guard !Task.isCancelled else { return .cancelled }
        guard let session = AVAssetExportSession(asset: asset, presetName: preset),
              session.supportedFileTypes.contains(.mp4) else { return .failed(interrupted: false) }
        let dest = PickedVideoCleanup.stagingDir.appendingPathComponent("video_\(UUID().uuidString).mp4")
        session.outputURL = dest
        session.outputFileType = .mp4
        session.shouldOptimizeForNetworkUse = true
        let box = SessionBox(session)
        await MainActor.run { progress(0) }
        let poller = Task { @MainActor in
            while !Task.isCancelled {
                progress(Double(box.session.progress))
                try? await Task.sleep(nanoseconds: 250_000_000)
            }
        }
        await withTaskCancellationHandler {
            await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                box.session.exportAsynchronously { cont.resume() }
            }
        } onCancel: {
            box.session.cancelExport()
        }
        poller.cancel()
        let attrs = try? FileManager.default.attributesOfItem(atPath: dest.path)
        let outSize = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
        if session.status == .completed, outSize > 0 {
            await MainActor.run { progress(1) }
            return .done(dest)
        }
        try? FileManager.default.removeItem(at: dest)
        if session.status == .cancelled || Task.isCancelled { return .cancelled }
        let error = session.error as NSError?
        print("[Video] 导出 mp4 失败，回退原文件: \(error?.localizedDescription ?? "status=\(session.status.rawValue)")")
        let interrupted = error?.domain == AVFoundationErrorDomain && error?.code == AVError.Code.operationInterrupted.rawValue
        return .failed(interrupted: interrupted)
    }

    /// 等 App 回到前台（最多 10 分钟）；任务被取消或超时返回 false。
    private static func waitUntilActive() async -> Bool {
        for _ in 0..<1200 {
            if Task.isCancelled { return false }
            if await MainActor.run(body: { UIApplication.shared.applicationState == .active }) { return true }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        return false
    }
}

/// UIApplication 后台任务的一次性令牌：begin/end 都在主线程执行，end 幂等；
/// 过期 handler 里立即 end，否则系统会直接强杀 App。
final class BackgroundTaskToken: @unchecked Sendable {
    private let lock = NSLock()
    private var id: UIBackgroundTaskIdentifier = .invalid

    private init() {}

    static func begin(name: String) async -> BackgroundTaskToken {
        let token = BackgroundTaskToken()
        await MainActor.run {
            let id = UIApplication.shared.beginBackgroundTask(withName: name) { token.endOnMain() }
            token.store(id)
        }
        return token
    }

    func end() async {
        await MainActor.run { endOnMain() }
    }

    private func store(_ value: UIBackgroundTaskIdentifier) {
        lock.lock(); id = value; lock.unlock()
    }

    private func take() -> UIBackgroundTaskIdentifier {
        lock.lock(); defer { lock.unlock() }
        let value = id
        id = .invalid
        return value
    }

    /// 只在主线程调用（MainActor.run 内或 UIKit 的过期 handler，后者由系统在主线程回调）。
    private func endOnMain() {
        let value = take()
        guard value != .invalid else { return }
        UIApplication.shared.endBackgroundTask(value)
    }
}

/// 上传完成或放弃后清理 touliao-upload 目录里的旧文件（超过1小时的），避免缓存无限增长。
enum PickedVideoCleanup {
    /// Caches 目录下的 staging 子目录：不用 temporaryDirectory，见 PickedVideoFile 顶部说明。
    static let stagingDir: URL = {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("touliao-upload", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    static func cleanupOldFiles() {
        let dir = stagingDir
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let cutoff = Date().addingTimeInterval(-3600)
        for f in files {
            if let mtime = try? f.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate, mtime < cutoff {
                try? FileManager.default.removeItem(at: f)
            }
        }
    }

    static func removeFile(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
    }
}
