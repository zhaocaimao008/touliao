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
    var background: String = ""           // 聊天专属背景图（空=无）
    var burnAfter: Int = 0                // 阅后即焚秒数（0=关闭）
    var manuallyUnread: Int = 0           // 手动标为未读（1=是）
    var otherUser: OtherUser?             // 私聊对端信息(后端 listConversations 返回);通话/资料取对端 id 用
    var hasMention: Bool = false          // 有未读的@我(后端按 last_read_at 派生);读后随刷新消失

    /// 私聊对端 id：优先 otherUser.id(可靠);群聊为 nil
    var peerId: String? { otherUser?.id }

    struct OtherUser: Decodable, Equatable, Hashable {
        let id: String
        var username: String = ""
        var avatar: String = ""
    }

    enum CodingKeys: String, CodingKey {
        case id, type, name, avatar
        case lastMessage, lastMessageType, lastTime, lastSenderName
        case unreadCount, pinned, muted, background, otherUser, hasMention
        case burnAfter = "burn_after"
        case manuallyUnread = "manually_unread"
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
        background = (try? c.decode(String.self, forKey: .background)) ?? ""
        burnAfter = (try? c.decode(Int.self, forKey: .burnAfter)) ?? 0
        manuallyUnread = (try? c.decode(Int.self, forKey: .manuallyUnread)) ?? 0
        otherUser = try? c.decode(OtherUser.self, forKey: .otherUser)
        hasMention = (try? c.decode(Bool.self, forKey: .hasMention)) ?? false
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
    var edited: Int = 0
    var deleted: Int = 0
    var reactions: [MessageReaction] = []
    var replyTo: ReplyPreview?

    // ── 客户端本地态（不来自服务端；对齐 Web/Android 乐观消息）──
    // localStatus: nil=已送达 | "sending"=乐观发送中 | "failed"=发送失败
    var localStatus: String? = nil
    // 幂等键：乐观消息发送时生成、失败重发复用，后端据此去重；广播回声按此认领乐观气泡
    var clientMsgId: String? = nil
    /// 由定时任务发送的消息（is_scheduled=1），气泡右下角显示「定时」角标
    var isScheduled: Int = 0
    /// 语音转文字结果（后端消息查询已返回该列；非空=已转写，直接显示，不再显示「转文字」按钮）
    var transcript: String? = nil
    // 2026-08-29 统一附件系统：真实 mime/size（服务端魔数校验后落库），供文件卡片显示
    // 类型/大小、判断能否 App 内预览（PDF/Word/Excel/PPT）。旧消息可能为 nil。
    var fileMime: String? = nil
    var fileSize: Int64? = nil
    // 2026-08-29新增：语音/视频时长(秒)。后端此前从不写这个字段，语音气泡只能显示固定文字；
    // 现在上传时可选传duration，服务端落库后这里能拿到真实值渲染时长气泡。
    var duration: Int = 0

    enum CodingKeys: String, CodingKey {
        case id, type, content, reactions, replyTo, edited, deleted, transcript, duration
        case conversationId = "conversation_id"
        case senderId = "sender_id"
        case fileUrl = "file_url"
        case replyToId = "reply_to_id"
        case createdAt = "created_at"
        case clientMsgId = "client_msg_id"
        case senderName, senderAvatar
        case isScheduled = "is_scheduled"
        case fileMime = "file_mime"
        case fileSize = "file_size"
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
        edited = (try? c.decode(Int.self, forKey: .edited)) ?? 0
        deleted = (try? c.decode(Int.self, forKey: .deleted)) ?? 0
        reactions = (try? c.decode([MessageReaction].self, forKey: .reactions)) ?? []
        replyTo = try? c.decode(ReplyPreview.self, forKey: .replyTo)
        clientMsgId = try? c.decode(String.self, forKey: .clientMsgId)
        isScheduled = (try? c.decode(Int.self, forKey: .isScheduled)) ?? 0
        transcript = try? c.decode(String.self, forKey: .transcript)
        fileMime = try? c.decode(String.self, forKey: .fileMime)
        fileSize = try? c.decode(Int64.self, forKey: .fileSize)
    }

    /// 便捷构造：从离线缓存快照还原「已确认历史消息」（localStatus/clientMsgId 均为 nil）。
    /// 其余字段由调用方（MsgCacheStore）逐一赋值。
    init(cachedId id: String, conversationId: String, senderId: String) {
        self.id = id
        self.conversationId = conversationId
        self.senderId = senderId
    }

    /// 便捷构造：本地乐观消息（发送中气泡）
    init(optimisticText id: String, conversationId: String, senderId: String,
         content: String, replyToId: String?, replyTo: ReplyPreview?, clientMsgId: String) {
        self.id = id
        self.conversationId = conversationId
        self.senderId = senderId
        self.type = "text"
        self.content = content
        self.replyToId = replyToId
        self.createdAt = Date().timeIntervalSince1970
        self.replyTo = replyTo
        self.localStatus = LocalMsgStatus.sending
        self.clientMsgId = clientMsgId
    }
}

/// 消息本地发送态常量（对齐 Android LocalMsgStatus）
enum LocalMsgStatus {
    static let sending = "sending"
    static let failed = "failed"
}

struct MessageReaction: Decodable, Equatable {
    var emoji: String = ""
    var count: Int = 0
    var userIds: [String] = []   // 贴此表情的用户 id 列表（用于高亮「我」，对齐 Web）
    enum CodingKeys: String, CodingKey { case emoji, count, userIds }
    init(emoji: String = "", count: Int = 0, userIds: [String] = []) {
        self.emoji = emoji; self.count = count; self.userIds = userIds
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        emoji = (try? c.decode(String.self, forKey: .emoji)) ?? ""
        count = (try? c.decode(Int.self, forKey: .count)) ?? 0
        userIds = (try? c.decode([String].self, forKey: .userIds)) ?? []
    }
    /// 当前用户是否贴过此表情
    func mine(_ myId: String) -> Bool { userIds.contains(myId) }
}

struct ReplyPreview: Decodable, Equatable {
    var id: String = ""
    var type: String = "text"
    var content: String = ""
    var senderName: String = ""
    var fileUrl: String? = nil   // 图片/表情/视频等媒体地址(引用条缩略图用, 对齐 Web)
    var deleted: Int = 0   // 1 = 被回复的消息已撤回（显示「消息已撤回」，对齐 Web）
    enum CodingKeys: String, CodingKey { case id, type, content, senderName, fileUrl = "file_url", deleted }
    init(id: String = "", type: String = "text", content: String = "", senderName: String = "", fileUrl: String? = nil, deleted: Int = 0) {
        self.id = id; self.type = type; self.content = content; self.senderName = senderName; self.fileUrl = fileUrl; self.deleted = deleted
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        type = (try? c.decode(String.self, forKey: .type)) ?? "text"
        content = (try? c.decode(String.self, forKey: .content)) ?? ""
        senderName = (try? c.decode(String.self, forKey: .senderName)) ?? ""
        fileUrl = (try? c.decode(String.self, forKey: .fileUrl)) ?? nil
        deleted = (try? c.decode(Int.self, forKey: .deleted)) ?? 0
    }
}

/// 定时消息（GET /api/messages/schedule 列表项；与 Android ScheduledMessage 对齐）
struct ScheduledMessage: Decodable, Identifiable {
    let id: String
    var conversationId: String = ""
    var content: String = ""
    var type: String = "text"
    var sendAt: Double = 0          // UNIX 秒，后端要求 ≥15分钟后 ≤30天
    var status: String = "pending"  // pending | sent | cancelled

    enum CodingKeys: String, CodingKey {
        case id, content, type, status
        case conversationId = "conversation_id"
        case sendAt = "send_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        conversationId = (try? c.decode(String.self, forKey: .conversationId)) ?? ""
        content = (try? c.decode(String.self, forKey: .content)) ?? ""
        type = (try? c.decode(String.self, forKey: .type)) ?? "text"
        sendAt = (try? c.decode(Double.self, forKey: .sendAt)) ?? 0
        status = (try? c.decode(String.self, forKey: .status)) ?? "pending"
    }
}

/// @我消息聚合（GET /api/messages/mentions/me 列表项；与 Android MentionItem 对齐）
struct MentionItem: Decodable, Identifiable {
    var id: String = ""         // msgId
    var convId: String = ""
    var convName: String = ""
    var senderName: String = ""
    var content: String = ""
    var createdAt: Double = 0

    enum CodingKeys: String, CodingKey {
        case id = "msgId"
        case convId, convName, senderName, content, createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        convId = (try? c.decode(String.self, forKey: .convId)) ?? ""
        convName = (try? c.decode(String.self, forKey: .convName)) ?? ""
        senderName = (try? c.decode(String.self, forKey: .senderName)) ?? ""
        content = (try? c.decode(String.self, forKey: .content)) ?? ""
        createdAt = (try? c.decode(Double.self, forKey: .createdAt)) ?? 0
    }
}

/// 会话文件聚合项（GET .../files 列表项；与 Android ConversationFile 对齐）
struct ConversationFile: Decodable, Identifiable, Equatable {
    var id: String = ""
    var type: String = "file"      // image | video | file
    var content: String = ""       // 文件名（文件类）/文本
    var fileUrl: String = ""       // 相对资源路径
    var createdAt: Double = 0      // epoch 秒
    var senderName: String = ""
    var fileSize: Int64? = nil

    enum CodingKeys: String, CodingKey {
        case id, type, content, senderName
        case fileUrl = "file_url"
        case createdAt = "created_at"
        case fileSize = "file_size"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        type = (try? c.decode(String.self, forKey: .type)) ?? "file"
        content = (try? c.decode(String.self, forKey: .content)) ?? ""
        fileUrl = (try? c.decode(String.self, forKey: .fileUrl)) ?? ""
        createdAt = (try? c.decode(Double.self, forKey: .createdAt)) ?? 0
        senderName = (try? c.decode(String.self, forKey: .senderName)) ?? ""
        fileSize = try? c.decode(Int64.self, forKey: .fileSize)
    }

    /// 文件名：优先 content，否则从 fileUrl 末段提取（去掉 query）
    var displayName: String {
        if !content.isEmpty { return content }
        let seg = fileUrl.components(separatedBy: "?").first?
            .components(separatedBy: "/").last ?? ""
        return seg.isEmpty ? "文件" : seg
    }
}

/// 会话文件聚合分页响应（items + total）
struct ConversationFilesResponse: Decodable {
    var items: [ConversationFile] = []
    var total: Int = 0

    enum CodingKeys: String, CodingKey { case items, total }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = (try? c.decode([ConversationFile].self, forKey: .items)) ?? []
        total = (try? c.decode(Int.self, forKey: .total)) ?? 0
    }
}

/// 语音转文字响应（POST /api/messages/:msgId/transcribe）；cached=true 表示命中后端缓存
struct TranscribeResponse: Decodable {
    var text: String = ""
    var cached: Bool = false

    enum CodingKeys: String, CodingKey { case text, cached }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = (try? c.decode(String.self, forKey: .text)) ?? ""
        cached = (try? c.decode(Bool.self, forKey: .cached)) ?? false
    }
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
