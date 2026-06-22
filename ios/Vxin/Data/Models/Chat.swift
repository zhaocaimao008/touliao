import Foundation

/// 会话列表项 —— 对齐后端 listConversations 返回（与 Android Conversation 一致）
struct Conversation: Decodable, Identifiable, Equatable, Hashable {
    let id: String
    var type: String = "private"          // private | group | filehelper
    var name: String = ""
    var avatar: String = ""
    var lastMessage: String?
    var lastMessageType: String?
    var lastTime: Double?                 // epoch 秒
    var lastSenderName: String?
    var unreadCount: Int = 0
    var pinned: Int = 0
    var muted: Int = 0

    enum CodingKeys: String, CodingKey {
        case id, type, name, avatar
        case lastMessage, lastMessageType, lastTime, lastSenderName
        case unreadCount, pinned, muted
    }

    /// 本地构建（如刚创建的私聊会话），用于导航跳转
    init(id: String, type: String = "private", name: String = "", avatar: String = "") {
        self.id = id
        self.type = type
        self.name = name
        self.avatar = avatar
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        type = (try? c.decode(String.self, forKey: .type)) ?? "private"
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        avatar = (try? c.decode(String.self, forKey: .avatar)) ?? ""
        lastMessage = try? c.decode(String.self, forKey: .lastMessage)
        lastMessageType = try? c.decode(String.self, forKey: .lastMessageType)
        lastTime = try? c.decode(Double.self, forKey: .lastTime)
        lastSenderName = try? c.decode(String.self, forKey: .lastSenderName)
        unreadCount = (try? c.decode(Int.self, forKey: .unreadCount)) ?? 0
        pinned = (try? c.decode(Int.self, forKey: .pinned)) ?? 0
        muted = (try? c.decode(Int.self, forKey: .muted)) ?? 0
    }
}

/// 消息 —— REST history 与 Socket new_message 共用（与 Android Message 一致）
struct Message: Decodable, Identifiable, Equatable {
    let id: String
    var conversationId: String
    var senderId: String
    var type: String = "text"             // text | image | voice | file | video
    var content: String = ""
    var fileUrl: String = ""
    var replyToId: String?
    var createdAt: Double = 0             // epoch 秒
    var senderName: String = ""
    var senderAvatar: String = ""
    var reactions: [MessageReaction] = []
    var replyTo: ReplyPreview?

    enum CodingKeys: String, CodingKey {
        case id, type, content, reactions, replyTo
        case conversationId = "conversation_id"
        case senderId = "sender_id"
        case fileUrl = "file_url"
        case replyToId = "reply_to_id"
        case createdAt = "created_at"
        case senderName, senderAvatar
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        conversationId = (try? c.decode(String.self, forKey: .conversationId)) ?? ""
        senderId = (try? c.decode(String.self, forKey: .senderId)) ?? ""
        type = (try? c.decode(String.self, forKey: .type)) ?? "text"
        content = (try? c.decode(String.self, forKey: .content)) ?? ""
        fileUrl = (try? c.decode(String.self, forKey: .fileUrl)) ?? ""
        replyToId = try? c.decode(String.self, forKey: .replyToId)
        createdAt = (try? c.decode(Double.self, forKey: .createdAt)) ?? 0
        senderName = (try? c.decode(String.self, forKey: .senderName)) ?? ""
        senderAvatar = (try? c.decode(String.self, forKey: .senderAvatar)) ?? ""
        reactions = (try? c.decode([MessageReaction].self, forKey: .reactions)) ?? []
        replyTo = try? c.decode(ReplyPreview.self, forKey: .replyTo)
    }
}

struct MessageReaction: Decodable, Equatable {
    var emoji: String = ""
    var count: Int = 0
}

struct ReplyPreview: Decodable, Equatable {
    var id: String = ""
    var type: String = "text"
    var content: String = ""
    var senderName: String = ""
}

/// 群置顶消息（GET .../pinned-messages）
struct PinnedMessage: Decodable, Identifiable, Equatable {
    var msgId: String = ""
    var type: String = "text"
    var content: String = ""
    var fileUrl: String = ""
    var senderName: String = ""
    var pinnedByName: String = ""

    var id: String { msgId }

    enum CodingKeys: String, CodingKey {
        case msgId, type, content, senderName, pinnedByName
        case fileUrl = "file_url"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        msgId = (try? c.decode(String.self, forKey: .msgId)) ?? ""
        type = (try? c.decode(String.self, forKey: .type)) ?? "text"
        content = (try? c.decode(String.self, forKey: .content)) ?? ""
        fileUrl = (try? c.decode(String.self, forKey: .fileUrl)) ?? ""
        senderName = (try? c.decode(String.self, forKey: .senderName)) ?? ""
        pinnedByName = (try? c.decode(String.self, forKey: .pinnedByName)) ?? ""
    }
}
