import Foundation
import CoreTransferable
import UniformTypeIdentifiers

/// 2026-08-29 iOS视频发送修复新增：PhotosPickerItem 选中视频后，用 FileRepresentation
/// （而非 Data.self）拿到系统临时文件，再流式拷贝到投聊自己的目录，得到稳定可读路径。
/// 全程不把视频内容读进 Swift Data 常驻内存——FileRepresentation 本身就是"文件到文件"的
/// 系统级拷贝；下面 importing 闭包里我们再拷一次到自己的目录（用 FileManager 整文件拷贝，
/// 系统层面同样走的是文件系统调用，不经用户态内存缓冲），避免依赖 picker 返回的临时 URL
/// （该 URL 生命周期不稳定，picker 关闭后可能被系统提前清理）。
/// iCloud 视频：PhotosPickerItem 的 Transferable 传输过程由系统负责在需要时从 iCloud 下载，
/// 这里不用额外处理，只是可能耗时较久（用户能看到 picker 里的下载态）。
///
/// 2026-08-29 真机复现根因：staging 目录曾放在 `FileManager.default.temporaryDirectory`，
/// 真机报错精确到"文件不存在"(而非空/读取权限问题)——系统 tmp 目录在 App 被系统挂起时
/// (呈现 PhotosPicker 系统选择器期间，宿主 App 常被短暂 suspend)可能被系统直接清空，
/// Apple 官方文档对此有明确说明。改用 Caches 目录：同样是 App 沙盒内、系统不会因为
/// App 短暂挂起就清空，只在磁盘空间紧张时才可能清理，足够覆盖"选完立刻上传"这个窗口期。
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
