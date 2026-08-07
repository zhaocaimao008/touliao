import Foundation
import UIKit
import Photos
import Kingfisher

/// 保存聊天图片到系统相册。用 Kingfisher 已有的鉴权/缓存栈取图，
/// 再走 PHPhotoLibrary 写入相册（仅需 NSPhotoLibraryAddUsageDescription，Add-Only 授权，
/// 不需要完整相册读写权限）。
enum ImageSaver {
    enum SaveError: LocalizedError {
        case downloadFailed
        case permissionDenied
        case saveFailed

        var errorDescription: String? {
            switch self {
            case .downloadFailed: return "图片加载失败"
            case .permissionDenied: return "没有相册权限，请在设置中开启"
            case .saveFailed: return "保存失败"
            }
        }
    }

    /// - Parameter rawUrl: 未解析的原始路径（会内部调用 MediaUrlResolver 解析+鉴权）
    static func saveToPhotos(rawUrl: String?) async throws {
        guard let resolved = MediaUrlResolver.resolve(rawUrl),
              let url = URL(string: resolved) else {
            throw SaveError.downloadFailed
        }

        let image: UIImage = try await withCheckedThrowingContinuation { continuation in
            KingfisherManager.shared.retrieveImage(with: url) { result in
                switch result {
                case .success(let value):
                    continuation.resume(returning: value.image)
                case .failure:
                    continuation.resume(throwing: SaveError.downloadFailed)
                }
            }
        }

        let status = await requestAddOnlyAuthorization()
        guard status == .authorized || status == .limited else {
            throw SaveError.permissionDenied
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            }, completionHandler: { success, _ in
                if success {
                    continuation.resume(returning: ())
                } else {
                    continuation.resume(throwing: SaveError.saveFailed)
                }
            })
        }
    }

    private static func requestAddOnlyAuthorization() async -> PHAuthorizationStatus {
        await withCheckedContinuation { continuation in
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                continuation.resume(returning: status)
            }
        }
    }
}
