import ImageIO
import UIKit

/// 上传前把图片编码为服务端能审核的 JPEG。
///
/// 服务端审核（backend-v2 localMediaScanner）解码像素上限为 4000 万；iPhone 4800 万像素原图
/// （HEIF 最大）直接转 JPEG 仍会被拒为「图片损坏、尺寸过大或格式无法解析」。超限时缩到长边 ≤ 4096，
/// 未超限保持原分辨率（与原先 jpegData 行为一致）。
enum UploadImage {
    static let serverMaxPixels = 40_000_000
    static let maxEdge = 4096

    static func exceedsServerLimit(width: Int, height: Int) -> Bool {
        width * height > serverMaxPixels
    }

    /// 相册原始数据 → JPEG；ImageIO 缩略图按 EXIF 方向旋转且不整幅解码，避免大图内存峰值。
    static func jpeg(from data: Data, quality: CGFloat) -> Data? {
        if let source = CGImageSourceCreateWithData(data as CFData, nil),
           let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
           let w = props[kCGImagePropertyPixelWidth] as? Int,
           let h = props[kCGImagePropertyPixelHeight] as? Int,
           exceedsServerLimit(width: w, height: h) {
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maxEdge,
            ]
            if let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) {
                return UIImage(cgImage: cg).jpegData(compressionQuality: quality)
            }
        }
        return UIImage(data: data)?.jpegData(compressionQuality: quality)
    }

    /// 已解码的 UIImage → JPEG，超限时等比缩小。
    static func jpeg(from image: UIImage, quality: CGFloat) -> Data? {
        let w = Int(image.size.width * image.scale), h = Int(image.size.height * image.scale)
        guard exceedsServerLimit(width: w, height: h) else { return image.jpegData(compressionQuality: quality) }
        let ratio = CGFloat(maxEdge) / CGFloat(max(w, h))
        let size = CGSize(width: floor(CGFloat(w) * ratio), height: floor(CGFloat(h) * ratio))
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let scaled = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return scaled.jpegData(compressionQuality: quality)
    }
}
