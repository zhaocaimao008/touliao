import CoreGraphics

/// 投聊 圆角规范 —— 单一真相源（对齐 Web design-tokens.css / Android VxinRadius）。
/// 命名与取值跨端保持一致，统一圆角语汇：
///   tag=4  sm=6  badge=10  md=12  avatar=14  card=16  lg=18  xl=20
/// 说明：thumb(8) 与 pill(25) 为移动端历史取值，暂保留原值以零视觉回归。
enum VxinRadius {
    static let tag: CGFloat = 4      // 小标签/小图片角标（Web --radius-tag）
    static let sm: CGFloat = 6       // 小卡片/图片（Web --radius-sm）
    static let thumb: CGFloat = 8    // 缩略图/次级卡片（移动端历史值）
    static let badge: CGFloat = 10   // 气泡/徽标/常规卡片（Web --radius-badge）
    static let md: CGFloat = 12      // 输入框/按钮/中卡片（Web --radius-md）
    static let avatar: CGFloat = 14  // 头像圆润方形（Web --radius-avatar）
    static let card: CGFloat = 16    // 内容大卡片（Web --radius-card）
    static let lg: CGFloat = 18      // 弹窗/大卡片（Web --radius-lg）
    static let xl: CGFloat = 20      // 大头像/超大卡片（Web --radius-avatar-lg）
    static let pill: CGFloat = 25    // 认证按钮胶囊（移动端历史值）
}
