import CoreGraphics

/// v信 字号规范 —— 单一真相源（对齐 Web design-tokens.css --text-* 体系 / Android VxinTextSize）。
/// 命名与取值跨端保持一致，统一字号语汇（单位 pt≈px）：
///   xs2=10  xs=11  sm=12  sm2=13  base=14  md=15  lg=16  xl=18  xxl=20  xxxl=24
/// 说明：展示型大字（余额/品牌名/认证标题等）见下方展示字阶 display*；
///       emoji / SF Symbol 图标 glyph 属内容字形，非文字排版，保留各处原始 size 值。
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

    // ── 展示字阶：跨端一致（对齐 Web --text-display-* / Android VxinTextSize 展示档）──
    // 用于品牌名、大数字、认证页标题等展示型文字，非通用正文字阶。
    static let displaySm: CGFloat = 22   // 通话对方名/资料大字（Web --text-display-sm）
    static let display: CGFloat = 26     // 认证页标题（注册/忘记密码，Web --text-display）
    static let displayLg: CGFloat = 30   // 登录品牌名（Web --text-display-lg）
    static let displayXl: CGFloat = 40   // 钱包余额大数字（Web --text-display-xl）
}
