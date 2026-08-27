import Foundation
import UIKit
import Kingfisher

/// 分享聊天媒体（图片/视频/文件/文档）到第三方软件。
/// 做法：把资源下载到临时文件（图片走 Kingfisher 复用鉴权/缓存栈；其它走 URLSession，
///   URL 已带 ?token= 鉴权，见 MediaUrlResolver），再交 UIActivityViewController 分享。
/// 直接分享 http 链接对方 App 拿不到鉴权、也不是「文件分享」体验，故必须落地成文件。
enum FileShareHelper {
    enum ShareError: LocalizedError {
        case badUrl
        case downloadFailed
        var errorDescription: String? {
            switch self {
            case .badUrl: return "无效的资源地址"
            case .downloadFailed: return "下载失败"
            }
        }
    }

    /// 下载资源到临时目录并返回本地文件 URL（供 ShareSheet 使用）。
    /// - Parameters:
    ///   - rawUrl: 未解析的原始路径（内部走 MediaUrlResolver 解析 + 鉴权）
    ///   - filename: 展示/保存用文件名（含扩展名更佳）
    ///   - isImage: 是否图片（走 Kingfisher）
    static func prepareShareFile(rawUrl: String?, filename: String?, isImage: Bool) async throws -> URL {
        guard let resolved = MediaUrlResolver.resolve(rawUrl),
              let url = URL(string: resolved) else {
            throw ShareError.badUrl
        }

        let name = sanitizedName(filename, url: url, isImage: isImage)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("share", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: dest)

        if isImage {
            // 图片：Kingfisher 取原图（复用鉴权/缓存），写 PNG/JPEG 到临时文件
            let image: UIImage = try await withCheckedThrowingContinuation { cont in
                KingfisherManager.shared.retrieveImage(with: url) { result in
                    switch result {
                    case .success(let value): cont.resume(returning: value.image)
                    case .failure: cont.resume(throwing: ShareError.downloadFailed)
                    }
                }
            }
            let isPng = name.lowercased().hasSuffix(".png")
            let data = isPng ? image.pngData() : image.jpegData(compressionQuality: 0.95)
            guard let bytes = data else { throw ShareError.downloadFailed }
            try bytes.write(to: dest)
        } else {
            // 视频/文件/文档：URLSession 下载（URL 已带 token）
            let (tmp, resp) = try await URLSession.shared.download(from: url)
            if let http = resp as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                throw ShareError.downloadFailed
            }
            try FileManager.default.moveItem(at: tmp, to: dest)
        }
        return dest
    }

    private static func sanitizedName(_ filename: String?, url: URL, isImage: Bool) -> String {
        let raw = (filename?.trimmingCharacters(in: .whitespaces)).flatMap { $0.isEmpty ? nil : $0 }
        let fromUrl = url.deletingPathExtension().lastPathComponent
        let ext = url.pathExtension
        var chosen: String
        if let raw = raw, raw.contains(".") {
            chosen = raw
        } else if let raw = raw, !ext.isEmpty {
            chosen = "\(raw).\(ext)"
        } else if !url.lastPathComponent.isEmpty && url.lastPathComponent.contains(".") {
            chosen = url.lastPathComponent
        } else if isImage {
            chosen = "\(fromUrl.isEmpty ? "image_\(Int(Date().timeIntervalSince1970))" : fromUrl).jpg"
        } else {
            chosen = "file_\(Int(Date().timeIntervalSince1970))"
        }
        // 清洗非法字符
        let illegal = CharacterSet(charactersIn: "/\\:*?\"<>|")
        chosen = chosen.components(separatedBy: illegal).joined(separator: "_")
        return String(chosen.prefix(120))
    }
}
