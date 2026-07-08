import Foundation

/// 会话/消息时间显示（对齐 Android formatChatTime）：
/// 今天 → HH:mm；昨天 → 昨天 HH:mm；本周内 → 周X HH:mm；
/// 今年更早 → M月d日 HH:mm；跨年 → yyyy年M月d日 HH:mm
func formatChatTime(_ epochSeconds: Double?) -> String {
    guard let epochSeconds, epochSeconds > 0 else { return "" }
    let date = Date(timeIntervalSince1970: epochSeconds)
    let cal = Calendar.current
    let hm = DateFormatter()
    hm.dateFormat = "HH:mm"
    let hmStr = hm.string(from: date)

    if cal.isDateInToday(date) {
        return hmStr
    }
    if cal.isDateInYesterday(date) {
        return "昨天 \(hmStr)"
    }
    let dayDiff = cal.dateComponents([.day],
        from: cal.startOfDay(for: date),
        to: cal.startOfDay(for: Date())).day ?? 0
    let sameYear = cal.component(.year, from: date) == cal.component(.year, from: Date())
    if dayDiff >= 2 && dayDiff <= 6 {
        let week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
        let wd = cal.component(.weekday, from: date) - 1
        return "\(week[wd]) \(hmStr)"
    }
    let comps = cal.dateComponents([.year, .month, .day], from: date)
    if sameYear {
        return "\(comps.month ?? 0)月\(comps.day ?? 0)日 \(hmStr)"
    }
    return "\(comps.year ?? 0)年\(comps.month ?? 0)月\(comps.day ?? 0)日 \(hmStr)"
}

/// 通话时长格式化(mm:ss，超 1 小时则 H:mm:ss)，对齐微信/安卓
func formatCallDuration(from start: Date, now: Date = Date()) -> String {
    let secs = max(0, Int(now.timeIntervalSince(start)))
    let h = secs / 3600, m = (secs % 3600) / 60, s = secs % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, s)
                 : String(format: "%02d:%02d", m, s)
}

/// 是否需要显示时间分隔：首条 或 与上一条间隔超 5 分钟
func shouldShowMessageTime(prev: Double?, cur: Double) -> Bool {
    if cur <= 0 { return false }
    guard let prev, prev > 0 else { return true }
    return cur - prev >= 5 * 60
}
