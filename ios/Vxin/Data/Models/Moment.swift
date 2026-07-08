import Foundation

struct MomentAuthor: Decodable, Hashable {
    var id: String = ""
    var username: String = ""
    var avatar: String = ""
}

struct MomentLike: Decodable, Hashable {
    var userId: String = ""
    var username: String = ""
    enum CodingKeys: String, CodingKey { case userId = "user_id"; case username }
    init(userId: String = "", username: String = "") { self.userId = userId; self.username = username }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userId = (try? c.decode(String.self, forKey: .userId)) ?? ""
        username = (try? c.decode(String.self, forKey: .username)) ?? ""
    }
}

struct MomentComment: Decodable, Identifiable, Hashable {
    var id: String = ""
    var userId: String = ""
    var content: String = ""
    var username: String = ""
    var replyToUsername: String = ""   // 被回复人昵称(后端 enrich，用于显示「回复 X」)
    enum CodingKeys: String, CodingKey {
        case id, content, username
        case userId = "user_id"
        case replyToUsername = "reply_to_username"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        userId = (try? c.decode(String.self, forKey: .userId)) ?? ""
        content = (try? c.decode(String.self, forKey: .content)) ?? ""
        username = (try? c.decode(String.self, forKey: .username)) ?? ""
        replyToUsername = (try? c.decode(String.self, forKey: .replyToUsername)) ?? ""
    }
}

struct Moment: Decodable, Identifiable {
    let id: String
    var userId: String = ""
    var content: String = ""
    var images: [String] = []
    var visibility: String = "all"
    var createdAt: Double = 0
    var author: MomentAuthor = MomentAuthor()
    var likes: [MomentLike] = []
    var likeCount: Int = 0
    var liked: Bool = false
    var comments: [MomentComment] = []
    var commentCount: Int = 0

    enum CodingKeys: String, CodingKey {
        case id, content, images, visibility, author, likes, likeCount, liked, comments, commentCount
        case userId = "user_id"
        case createdAt = "created_at"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        userId = (try? c.decode(String.self, forKey: .userId)) ?? ""
        content = (try? c.decode(String.self, forKey: .content)) ?? ""
        images = (try? c.decode([String].self, forKey: .images)) ?? []
        visibility = (try? c.decode(String.self, forKey: .visibility)) ?? "all"
        createdAt = (try? c.decode(Double.self, forKey: .createdAt)) ?? 0
        author = (try? c.decode(MomentAuthor.self, forKey: .author)) ?? MomentAuthor()
        likes = (try? c.decode([MomentLike].self, forKey: .likes)) ?? []
        likeCount = (try? c.decode(Int.self, forKey: .likeCount)) ?? 0
        liked = (try? c.decode(Bool.self, forKey: .liked)) ?? false
        comments = (try? c.decode([MomentComment].self, forKey: .comments)) ?? []
        commentCount = (try? c.decode(Int.self, forKey: .commentCount)) ?? 0
    }
}

struct MomentLikeResponse: Decodable { var liked: Bool = false; var likeCount: Int = 0 }
struct MomentImagesResponse: Decodable { var urls: [String] = [] }

// GET /moments/:id/comments 分页响应（查看全部评论用）
struct CommentPage: Decodable { var items: [MomentComment] = []; var total: Int = 0; var hasMore: Bool = false }

// ── 朋友圈互动通知（谁赞了/评论了我的动态）──────────────────────
struct MomentNotifActor: Decodable, Hashable { var id = ""; var username = ""; var avatar = "" }
struct MomentNotifMoment: Decodable, Hashable { var content = ""; var thumb = "" }

struct MomentNotification: Decodable, Identifiable, Hashable {
    var id = ""
    var type = ""              // like | comment
    var momentId = ""
    var commentId: String? = nil
    var read = false
    var createdAt: Double = 0
    var actor = MomentNotifActor()
    var moment = MomentNotifMoment()
    var commentContent = ""
    enum CodingKeys: String, CodingKey {
        case id, type, momentId, commentId, read, createdAt, actor, moment, commentContent
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        type = (try? c.decode(String.self, forKey: .type)) ?? ""
        momentId = (try? c.decode(String.self, forKey: .momentId)) ?? ""
        commentId = try? c.decode(String.self, forKey: .commentId)
        read = (try? c.decode(Bool.self, forKey: .read)) ?? false
        createdAt = (try? c.decode(Double.self, forKey: .createdAt)) ?? 0
        actor = (try? c.decode(MomentNotifActor.self, forKey: .actor)) ?? MomentNotifActor()
        moment = (try? c.decode(MomentNotifMoment.self, forKey: .moment)) ?? MomentNotifMoment()
        commentContent = (try? c.decode(String.self, forKey: .commentContent)) ?? ""
    }
}

struct MomentNotifPage: Decodable { var items: [MomentNotification] = []; var total: Int = 0; var hasMore: Bool = false }
struct UnreadCountResponse: Decodable { var count: Int = 0 }
