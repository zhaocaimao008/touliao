import SwiftUI

extension Color {
    /// 投聊 品牌色 —— AURORA 极光靛（对齐 Web --brand-500 #6D5AE6）
    static let vxinBrand = Color(red: 0x6D / 255, green: 0x5A / 255, blue: 0xE6 / 255)
    static let vxinBrandLight = Color(red: 0x8A / 255, green: 0x78 / 255, blue: 0xEB / 255) // brand-400
    static let vxinBrandDark = Color(red: 0x5A / 255, green: 0x47 / 255, blue: 0xD6 / 255)  // brand-600
    static let vxinTeal = Color(red: 0x17 / 255, green: 0xB8 / 255, blue: 0xA6 / 255)       // 青碧辅助
    /// 兼容旧引用名（各 View 无需改动）：统一指向极光靛
    static let vxinGreen = vxinBrand
    /// 我的聊天气泡主色：极光靛（渐变见 chatBubbleGradient）
    static let vxinBubbleMine = vxinBrand
    /// 靛底气泡文字：白（保证对比度 WCAG AA）
    static let vxinBubbleText = Color.white
    static let vxinTextSecondary = Color(red: 0x88 / 255, green: 0x88 / 255, blue: 0x88 / 255)
    static let vxinError = Color(red: 0xFA / 255, green: 0x51 / 255, blue: 0x51 / 255)
    /// 语义成功/正向色（对齐 Web --color-success #00B42A）：通话接听、正向金额
    static let vxinSuccess = Color(red: 0x00 / 255, green: 0xB4 / 255, blue: 0x2A / 255)
    /// 在线状态圆点（对齐 Web --status-online #44C464，明暗一致鲜绿）
    static let vxinOnline = Color(red: 0x44 / 255, green: 0xC4 / 255, blue: 0x64 / 255)
    /// 支付/转账金钱主题绿（微信支付经典绿，对齐 Web --pay #07C160）：转账卡片
    static let vxinPay = Color(red: 0x07 / 255, green: 0xC1 / 255, blue: 0x60 / 255)
    static let vxinPayGradStart = Color(red: 0x09 / 255, green: 0xBB / 255, blue: 0x07 / 255)
    static let vxinPayGradEnd = Color(red: 0x07 / 255, green: 0xC1 / 255, blue: 0x60 / 255)
    /// 信息类横幅前景（群公告等）——收敛原散落纯蓝 #3B82F6，统一到品牌靛紫，与 Web 一致
    static let vxinInfoBannerFg = vxinBrand
    /// 卡面/悬浮层底色：跟随系统浅/深色（浅=白，深=近黑）
    static let vxinCard = Color(.secondarySystemBackground)
}

extension LinearGradient {
    /// 我方气泡极光渐变：靛 → 青碧（对齐 Web --grad-brand）
    static let vxinBubble = LinearGradient(
        colors: [.vxinBrandLight, .vxinBrand, .vxinTeal],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
    /// 转账卡片支付绿渐变（对齐 Web --pay-grad）
    static let vxinPay = LinearGradient(
        colors: [.vxinPayGradStart, .vxinPayGradEnd],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
}
