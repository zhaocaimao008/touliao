import Foundation
import Combine

private struct CreateMomentBody: Encodable { let content: String; let images: [String]; let visibility: String; let visibleTo: [String] }
private struct CommentBody: Encodable { let content: String }

final class MomentRepository {
    static let shared = MomentRepository()
    private init() {}

    private let api = APIClient.shared

    var eventsPublisher: AnyPublisher<Void, Never> { SocketService.shared.moments.eraseToAnyPublisher() }

    func timeline(limit: Int = 20, offset: Int = 0) async throws -> [Moment] {
        try await api.send("api/moments?limit=\(limit)&offset=\(offset)")
    }

    func create(content: String, images: [String], visibility: String, visibleTo: [String] = []) async throws -> Moment {
        try await api.send("api/moments", method: "POST", body: CreateMomentBody(content: content, images: images, visibility: visibility, visibleTo: visibleTo))
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

    func comment(_ id: String, content: String) async throws -> MomentComment {
        try await api.send("api/moments/\(id)/comment", method: "POST", body: CommentBody(content: content))
    }

    func delete(_ id: String) async throws {
        let _: EmptyResponse = try await api.send("api/moments/\(id)", method: "DELETE")
    }

    func deleteComment(_ commentId: String) async throws {
        let _: EmptyResponse = try await api.send("api/moments/comments/\(commentId)", method: "DELETE")
    }

    func comments(_ id: String, limit: Int = 50, offset: Int = 0) async throws -> CommentPage {
        try await api.send("api/moments/\(id)/comments?limit=\(limit)&offset=\(offset)")
    }
}
