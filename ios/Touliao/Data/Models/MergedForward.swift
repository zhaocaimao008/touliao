import Foundation

/// 合并转发（F5）—— Message.type == "merged" 时 content 为本文件序列化的 JSON，
/// 服务端透传不解析（见后端 messages.service ALLOWED_HTTP_TYPES）。语义对齐
/// Web utils/mergedForward.js 与 Android data/model/MergedForward.kt，四端口径统一。

/// 单条被合并消息的摘要（mid/type/sender/片段/时间，不含消息全文）
struct MergedForwardItem: Codable, Identifiable, Equatable {
    var mid: String = ""
    var type: String = "text"
    var sender: String = ""
    var senderName: String = ""
    var snippet: String = ""
    var ts: Double = 0

    var id: String { mid.isEmpty ? "\(sender)-\(ts)-\(snippet.hashValue)" : mid }
}

/// merged 消息 content 的结构
struct MergedForwardContent: Codable, Equatable {
    var title: String = ""
    var items: [MergedForwardItem] = []
}

/// 可参与合并转发的消息类型（红包/转账/系统消息等被过滤，与 Web FORWARDABLE_MESSAGE_TYPES 一致）
private let forwardableTypes: Set<String> = ["text", "image", "voice", "video", "file", "contact_card", "merged"]

/// 合并转发条数上限（对齐 Web buildMergedPayload slice(0, 30) 与后端 maxMergedLength）
let mergedForwardMaxItems = 30

func isForwardableMessage(_ msg: Message) -> Bool {
    msg.deleted == 0 && forwardableTypes.contains(msg.type)
}

/// 容错解码 merged content：坏 JSON/缺字段返回空结构，气泡降级显示「聊天记录」
func parseMergedContent(_ content: String) -> MergedForwardContent {
    guard let data = content.data(using: .utf8),
          let parsed = try? JSONDecoder().decode(MergedForwardContent.self, from: data) else {
        return MergedForwardContent()
    }
    return MergedForwardContent(title: parsed.title, items: Array(parsed.items.prefix(mergedForwardMaxItems)))
}

/// merged content 编码为 JSON 字符串（发送时用）
func encodeMergedContent(_ content: MergedForwardContent) -> String {
    let encoder = JSONEncoder()
    return (try? encoder.encode(content)).flatMap { String(data: $0, encoding: .utf8) } ?? "{\"title\":\"\",\"items\":[]}"
}

/// 名片消息 content 里的用户名（坏 JSON 返回空串）
private func mergedContactName(_ content: String) -> String {
    guard let data = content.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "" }
    if let name = obj["username"] as? String, !name.isEmpty { return name }
    return (obj["name"] as? String) ?? ""
}

/// 各类型在合并卡片/详情里的摘要文案（对齐 Web messageSnippet 的中文标签：
/// text 截 80 字；voice 带时长；名片/合并带名字；其余「[类型] 文件名」）
func mergedSnippetOf(_ msg: Message) -> String {
    func label(_ t: String) -> String {
        switch t {
        case "image": return "[图片]"
        case "voice": return "[语音]"
        case "video": return "[视频]"
        case "file": return "[文件]"
        case "contact_card", "contact": return "[名片]"
        case "merged": return "[聊天记录]"
        default: return "[\(t)]"
        }
    }
    switch msg.type {
    case "text":
        return String(msg.content.prefix(80))
    case "voice":
        return msg.duration > 0 ? "\(label("voice")) \(msg.duration)″" : label("voice")
    case "contact_card", "contact":
        let name = mergedContactName(msg.content)
        return name.isEmpty ? label("contact_card") : "\(label("contact_card")) \(name)"
    case "merged":
        let title = parseMergedContent(msg.content).title
        return title.isEmpty ? label("merged") : "\(label("merged")) \(title)"
    default:
        let trimmed = msg.content.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? label(msg.type) : "\(label(msg.type)) \(trimmed)"
    }
}

/// 组装 merged content：过滤不可转发类型、按传入顺序（即时间序）截前 30 条。
/// title 由调用方给（如「XX的聊天记录」/「N条聊天记录」）。
func buildMergedPayload(_ messages: [Message], title: String) -> MergedForwardContent {
    let items = messages.filter(isForwardableMessage).prefix(mergedForwardMaxItems).map { m in
        MergedForwardItem(mid: m.id, type: m.type, sender: m.senderId,
                          senderName: m.senderName, snippet: mergedSnippetOf(m), ts: m.createdAt)
    }
    return MergedForwardContent(title: title.isEmpty ? "\(items.count)" : title, items: Array(items))
}
