import Foundation
import CoreTransferable
import UniformTypeIdentifiers

/// 2026-08-29 iOS视频发送修复新增：PhotosPickerItem 选中视频后，用 FileRepresentation
/// （而非 Data.self）拿到系统临时文件，再流式拷贝到投聊自己的 tmp 目录，得到稳定可读路径。
/// 全程不把视频内容读进 Swift Data 常驻内存——FileRepresentation 本身就是"文件到文件"的
/// 系统级拷贝；下面 importing 闭包里我们再拷一次到自己的目录（用 FileManager 整文件拷贝，
/// 系统层面同样走的是文件系统调用，不经用户态内存缓冲），避免依赖 picker 返回的临时 URL
/// （该 URL 生命周期不稳定，picker 关闭后可能被系统提前清理）。
/// iCloud 视频：PhotosPickerItem 的 Transferable 传输过程由系统负责在需要时从 iCloud 下载，
/// 这里不用额外处理，只是可能耗时较久（用户能看到 picker 里的下载态）。
struct PickedVideoFile: Transferable {
    let url: URL
    let suggestedFileName: String

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { file in
            SentTransferredFile(file.url)
        } importing: { received in
            let ext = received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension
            let destDir = FileManager.default.temporaryDirectory.appendingPathComponent("touliao-upload", isDirectory: true)
            try? FileManager.default.createDirectory(at: destDir, withIntermediateDirectories: true)
            let dest = destDir.appendingPathComponent("video_\(UUID().uuidString).\(ext)")
            // 整文件系统级拷贝（FileManager.copyItem 走 syscall，不经用户态Data缓冲），
            // 得到一份投聊自己管理生命周期的稳定文件，picker 关闭也不受影响。
            try FileManager.default.copyItem(at: received.file, to: dest)
            return Self(url: dest, suggestedFileName: "video_\(Int(Date().timeIntervalSince1970)).\(ext)")
        }
    }
}

/// 上传完成或放弃后清理 touliao-upload 临时目录里的旧文件（超过1小时的），避免缓存无限增长。
enum PickedVideoCleanup {
    static func cleanupOldFiles() {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("touliao-upload", isDirectory: true)
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
