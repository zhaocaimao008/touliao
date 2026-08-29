import Foundation
import AVFoundation
import UIKit

/// 远程视频首帧缩略图：发送成功的视频消息此前气泡上只有一行"▶ 视频"文字，没有预览图，
/// 用户反馈"发送之后看不见视频预览"。这里按远程URL异步取首帧并缓存到内存，
/// 供聊天气泡展示，取不到帧也不影响气泡正常显示（退回占位色块+播放图标）。
enum VideoThumbnailLoader {
    private static let cache = NSCache<NSString, UIImage>()

    static func thumbnail(for urlString: String) async -> UIImage? {
        let key = urlString as NSString
        if let cached = cache.object(forKey: key) { return cached }
        guard let url = URL(string: urlString) else { return nil }
        let asset = AVURLAsset(url: url)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        // 气泡缩略图不需要原分辨率，限制尺寸省内存、且不必把整段视频都拖下来生成首帧。
        generator.maximumSize = CGSize(width: 480, height: 480)
        do {
            let result = try await generator.image(at: CMTime(seconds: 0.1, preferredTimescale: 600))
            let image = UIImage(cgImage: result.image)
            cache.setObject(image, forKey: key)
            return image
        } catch {
            return nil
        }
    }
}
