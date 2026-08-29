import Foundation

/// 人类可读文件大小格式化，供聊天文件卡片/文件详情页共用（对齐 Web/Android）。
func humanFileSize(_ bytes: Int64?) -> String? {
    guard let bytes, bytes >= 0 else { return nil }
    let kb = 1024.0, mb = kb * 1024, gb = mb * 1024
    let b = Double(bytes)
    if b < kb { return "\(bytes) B" }
    if b < mb { return String(format: "%.1f KB", b / kb) }
    if b < gb { return String(format: "%.1f MB", b / mb) }
    return String(format: "%.2f GB", b / gb)
}
