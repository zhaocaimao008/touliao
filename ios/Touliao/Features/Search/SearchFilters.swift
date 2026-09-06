import Foundation

// MARK: - 全局搜索分类筛选（F5，对齐 Web utils/messageSearchFilters.js / Android SearchFilters.kt：
// type 取值/时间区间语义/摘要规则四端口径统一）

/// 类型筛选选项（value 空串 = 全部；映射后端 messages.type）
struct SearchTypeOption: Identifiable, Equatable {
    let value: String
    let label: String
    let icon: String
    var id: String { value }
}

let messageSearchTypes: [SearchTypeOption] = [
    .init(value: "", label: "全部", icon: "○"),
    .init(value: "text", label: "文本", icon: "文"),
    .init(value: "image", label: "图片", icon: "▧"),
    .init(value: "voice", label: "语音", icon: "◖"),
    .init(value: "video", label: "视频", icon: "▶"),
    .init(value: "file", label: "文件", icon: "▤"),
    .init(value: "contact_card", label: "名片", icon: "人"),
    .init(value: "red_packet", label: "红包", icon: "包"),
    .init(value: "transfer", label: "转账", icon: "¥"),
    .init(value: "merged", label: "合并转发", icon: "☷"),
    .init(value: "call", label: "通话", icon: "☎"),
]

/// 时间筛选：空串=不限 | today=今天 | 7d=近7天 | 30d=近30天（秒级 from/to）
struct SearchTimeRangeOption: Identifiable, Equatable {
    let value: String
    let label: String
    var id: String { value.isEmpty ? "any" : value }
}

let messageSearchTimeRanges: [SearchTimeRangeOption] = [
    .init(value: "", label: "不限"),
    .init(value: "today", label: "今天"),
    .init(value: "7d", label: "7天"),
    .init(value: "30d", label: "30天"),
]

/// 由筛选状态构造请求参数（与 Web buildMessageSearchParams 同口径：
/// today → 今天 0 点起；7d/30d → 从当天 0 点再往前推 N 天）。
func buildSearchFilterParams(type: String, timeRange: String, senderId: String,
                             now: Date = Date()) -> SearchFilterParams {
    if type.isEmpty && timeRange.isEmpty && senderId.isEmpty { return SearchFilterParams() }
    var params = SearchFilterParams(
        type: type.isEmpty ? nil : type,
        senderId: senderId.isEmpty ? nil : senderId
    )
    if !timeRange.isEmpty {
        let cal = Calendar.current
        var start = cal.startOfDay(for: now)
        if timeRange == "7d" { start = cal.date(byAdding: .day, value: -7, to: start) ?? start }
        if timeRange == "30d" { start = cal.date(byAdding: .day, value: -30, to: start) ?? start }
        params.fromSec = Int64(start.timeIntervalSince1970)
        params.toSec = Int64(now.timeIntervalSince1970)
    }
    return params
}

/// 结果行类型图标
func messageSearchTypeIcon(_ type: String) -> String {
    messageSearchTypes.first { $0.value == type }?.icon ?? "•"
}

/// 解析结构化消息 content（名片/红包/转账/合并转发 的 JSON 字段），坏 JSON 返回空字典
private func parseContentObject(_ content: String) -> [String: Any] {
    guard let data = content.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
    return obj
}

private func compact(_ label: String, _ detail: String = "") -> String {
    let trimmed = detail.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? "[\(label)]" : "[\(label)] \(trimmed)"
}

/// 结果摘要（对齐 Web formatSearchMessageSummary / Android formatSearchMessageSummary）：
/// 结构化消息只透出人话字段（名片备注/红包祝福/转账备注/合并标题），不泄原始 JSON。
func formatSearchMessageSummary(type: String, content: String) -> String {
    let body = content.trimmingCharacters(in: .whitespacesAndNewlines)
    switch type {
    case "text": return body
    case "image": return compact("图片", body)
    case "voice": return compact("语音")
    case "video": return compact("视频", body)
    case "file": return compact("文件", body)
    case "contact_card", "contact": {
        let obj = parseContentObject(body)
        let name = (obj["remark"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            ?? (obj["username"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            ?? (obj["name"] as? String) ?? ""
        return compact("名片", name)
    }()
    case "red_packet": return compact("红包", (parseContentObject(body)["greeting"] as? String) ?? "")
    case "transfer": return compact("转账", (parseContentObject(body)["note"] as? String) ?? "")
    case "merged": return compact("聊天记录", (parseContentObject(body)["title"] as? String) ?? "")
    case "call": return compact("通话", body)
    default: return body.isEmpty ? compact(type) : body
    }
}
