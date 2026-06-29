import Foundation

/// 会话/消息时间显示：今天 HH:mm，昨天 昨天，更早 M月d日（对齐 Android formatChatTime）
func formatChatTime(_ epochSeconds: Double?) -> String {
    guard let epochSeconds, epochSeconds > 0 else { return "" }
    let date = Date(timeIntervalSince1970: epochSeconds)
    let cal = Calendar.current
    if cal.isDateInToday(date) {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: date)
    } else if cal.isDateInYesterday(date) {
        return "昨天"
    } else {
        let comps = cal.dateComponents([.month, .day], from: date)
        return "\(comps.month ?? 0)月\(comps.day ?? 0)日"
    }
}
