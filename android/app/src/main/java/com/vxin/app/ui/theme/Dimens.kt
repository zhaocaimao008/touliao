package com.touliao.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/**
 * 投聊 圆角规范 —— 单一真相源（对齐 Web design-tokens.css --radius-* 体系）。
 * 命名与取值与 Web 端保持一致，跨端统一圆角语汇：
 *   tag=4  sm=6  badge=10  md=12  avatar=14  card=16  lg=18  xl=20
 * 说明：thumb(8) 与 pill(25) 为移动端历史取值，暂保留原值以零视觉回归，
 *       后续如需与 Web(输入/按钮=12、胶囊=full) 对齐再单独走视觉验证。
 */
object VxinRadius {
    val tag = 4.dp        // 小标签/小图片角标（Web --radius-tag / --radius-button-sm）
    val sm = 6.dp         // 小卡片/图片（Web --radius-sm）
    val thumb = 8.dp      // 缩略图/次级卡片（移动端历史值）
    val badge = 10.dp     // 气泡/徽标/常规卡片（Web --radius-badge）
    val md = 12.dp        // 输入框/按钮/中卡片（Web --radius-md）
    val avatar = 14.dp    // 头像圆润方形（Web --radius-avatar）
    val card = 16.dp      // 内容大卡片（Web --radius-card）
    val lg = 18.dp        // 弹窗/大卡片（Web --radius-lg）
    val xl = 20.dp        // 大头像/超大卡片（Web --radius-avatar-lg）
    val pill = 25.dp      // 认证按钮胶囊（移动端历史值）

    /** 完全胶囊形（百分比 50%），用于圆形/全胶囊按钮 */
    val full = RoundedCornerShape(50)
}
