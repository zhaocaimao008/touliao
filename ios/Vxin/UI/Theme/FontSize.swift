import CoreGraphics

/// v信 字号规范 —— 单一真相源（对齐 Web design-tokens.css --text-* 体系 / Android VxinTextSize）。
/// 命名与取值跨端保持一致，统一字号语汇（单位 pt≈px）：
///   xs2=10  xs=11  sm=12  sm2=13  base=14  md=15  lg=16  xl=18  xxl=20  xxxl=24
/// 说明：emoji / SF Symbol 图标 glyph 与大号展示数字（余额、登录品牌名等，
///       多为 26pt 以上）属内容字形，非通用正文字阶，保留各处原始 size 值，
///       与 Android「22sp 以上展示号保留原值」策略一致，不并入通用字阶。
enum VxinFontSize {
    static let xs2: CGFloat = 10   // 角标/极小标注（Web --text-2xs）
    static let xs: CGFloat = 11    // 时间戳/系统消息（Web --text-xs）
    static let sm: CGFloat = 12    // 标签/说明文字（Web --text-sm）
    static let sm2: CGFloat = 13   // 次要正文/资料项（Web --text-sm2，高频）
    static let base: CGFloat = 14  // 正文/消息气泡（Web --text-base）
    static let md: CGFloat = 15    // 名称/对话标题（Web --text-md）
    static let lg: CGFloat = 16    // 页面标题（Web --text-lg）
    static let xl: CGFloat = 18    // 模态标题（Web --text-xl）
    static let xxl: CGFloat = 20   // 个人主页名字/大标题（Web --text-2xl）
    static let xxxl: CGFloat = 24  // 大标题（Web --text-3xl）
}
