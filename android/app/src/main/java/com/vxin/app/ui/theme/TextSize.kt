package com.vxin.app.ui.theme

import androidx.compose.ui.unit.sp

/**
 * v信 字号规范 —— 单一真相源（对齐 Web design-tokens.css --text-* 体系）。
 * 命名与取值与 Web 端保持一致，跨端统一字号语汇（单位 sp≈px）：
 *   xs2=10  xs=11  sm=12  sm2=13  base=14  md=15  lg=16  xl=18  xxl=20
 * 说明：22sp 以上为大号展示数字（余额/品牌名/认证标题等），归入展示字阶
 *       display*（跨端一致），非通用正文字阶。
 */
object VxinTextSize {
    val xs2 = 10.sp    // 角标/极小标注（Web --text-2xs）
    val xs = 11.sp     // 时间戳/系统消息（Web --text-xs）
    val sm = 12.sp     // 标签/说明文字（Web --text-sm）
    val sm2 = 13.sp    // 次要正文/资料项（Web --text-sm2，高频）
    val base = 14.sp   // 正文/消息气泡（Web --text-base）
    val md = 15.sp     // 名称/对话标题（Web --text-md）
    val lg = 16.sp     // 页面标题（Web --text-lg）
    val xl = 18.sp     // 模态标题（Web --text-xl）
    val xxl = 20.sp    // 个人主页名字/大标题（Web --text-2xl）

    // ── 展示字阶：跨端一致（对齐 Web --text-display-* / iOS VxinFontSize 展示档）──
    // 用于品牌名、大数字、认证页标题等展示型文字，非通用正文字阶。
    val displaySm = 22.sp   // 通话对方名/资料大字（Web --text-display-sm）
    val display = 26.sp     // 认证页标题（注册/忘记密码，Web --text-display）
    val displayLg = 30.sp   // 登录品牌名（Web --text-display-lg）
    val displayXl = 40.sp   // 钱包余额大数字（Web --text-display-xl）
}
