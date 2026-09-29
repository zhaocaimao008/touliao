import Foundation
import Combine

private struct CreateMomentBody: Encodable {
    let content: String
    let images: [String]
    let visibility: String
    let visibleTo: [String]
    // 视频动态（F5）：可选 1 段视频 + 可选封面；nil 不编码，避免 images 数组与空串语义混淆
    let video: String?
    let cover: String?
    enum CodingKeys: String, CodingKey { case content, images, visibility, visibleTo, video, cover }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(content, forKey: .content)
        try c.encode(images, forKey: .images)
        try c.encode(visibility, forKey: .visibility)
        try c.encode(visibleTo, forKey: .visibleTo)
        try c.encodeIfPresent(video, forKey: .video)
        try c.encodeIfPresent(cover, forKey: .cover)
    }
}
private struct CommentBody: Encodable {
    let content: String
    let replyToUser: String?   // 回复某条评论时带上被回复人 id；nil 则不回复(编码时省略)
}
private struct MomentVideoResponse: Decodable { let url: String }

final class MomentRepository {
    static let shared = MomentRepository()
    private init() {}

    private let api = APIClient.shared

    var eventsPublisher: AnyPublisher<Void, Never> { SocketService.shared.moments.eraseToAnyPublisher() }

    func timeline(limit: Int = 20, offset: Int = 0) async throws -> [Moment] {
        try await api.send("api/moments?limit=\(limit)&offset=\(offset)")
    }

    func create(content: String, images: [String], visibility: String, visibleTo: [String] = [],
                video: String? = nil, cover: String? = nil) async throws -> Moment {
        try await api.send("api/moments", method: "POST",
                           body: CreateMomentBody(content: content, images: images, visibility: visibility, visibleTo: visibleTo, video: video, cover: cover))
    }

    /// 朋友圈视频上传（F5）：POST /api/moments/video（单文件，字段名 video，服务端魔数校验），
    /// 返回 /uploads/moments/xxx.mp4 相对 URL，发布时随 video 字段引用。大文件走磁盘流式上传。
    func uploadVideo(fileURL: URL, fileName: String, mimeType: String) async throws -> String {
        let res: MomentVideoResponse = try await api.uploadFileStream(
            "api/moments/video", fileURL: fileURL, fileName: fileName, mimeType: mimeType, fieldName: "video"
        )
        return res.url
    }

    func uploadImages(_ datas: [(data: Data, name: String)]) async throws -> [String] {
        // 逐张上传后合并（后端 /images 支持多图，但 APIClient.upload 为单文件，这里顺序上传）
        var urls: [String] = []
        for d in datas {
            let res: MomentImagesResponse = try await api.upload("api/moments/images", fileData: d.data, fileName: d.name, mimeType: "image/jpeg", fieldName: "images")
            urls.append(contentsOf: res.urls)
        }
        return urls
    }

    func like(_ id: String) async throws -> MomentLikeResponse {
        try await api.send("api/moments/\(id)/like", method: "POST")
    }

    func comment(_ id: String, content: String, replyToUser: String? = nil) async throws -> MomentComment {
        let reply = (replyToUser?.isEmpty == false) ? replyToUser : nil
        return try await api.send("api/moments/\(id)/comment", method: "POST", body: CommentBody(content: content, replyToUser: reply))
    }

    func delete(_ id: String) async throws {
        let _: EmptyResponse = try await api.send("api/moments/\(id)", method: "DELETE")
    }

    func report(_ id: String) async throws {
        let _: EmptyResponse = try await api.send("api/moments/\(id)/report", method: "POST")
    }

    func deleteComment(_ commentId: String) async throws {
        let _: EmptyResponse = try await api.send("api/moments/comments/\(commentId)", method: "DELETE")
    }

    func comments(_ id: String, limit: Int = 50, offset: Int = 0) async throws -> CommentPage {
        try await api.send("api/moments/\(id)/comments?limit=\(limit)&offset=\(offset)")
    }

    // ── 互动通知 ──
    func notifications(limit: Int = 30, offset: Int = 0) async throws -> MomentNotifPage {
        try await api.send("api/moments/notifications?limit=\(limit)&offset=\(offset)")
    }
    func notifUnreadCount() async throws -> Int {
        let r: UnreadCountResponse = try await api.send("api/moments/notifications/unread-count")
        return r.count
    }
    func markNotificationsRead() async throws {
        let _: EmptyResponse = try await api.send("api/moments/notifications/read", method: "POST")
    }
}
