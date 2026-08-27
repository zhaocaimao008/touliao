package com.touliao.app.ui.theme

import androidx.compose.ui.graphics.Color

// 投聊 品牌色（AURORA 极光靛，对齐 Web 端 --brand-500 #6D5AE6）
val VxinBrand = Color(0xFF6D5AE6)         // 主品牌色 极光靛（brand-500）
val VxinBrandLight = Color(0xFF8A78EB)    // brand-400 渐变浅端
val VxinBrandDark = Color(0xFF5A47D6)     // brand-600 渐变深端 / 按下态
val VxinBrandMuted = Color(0xFFF1EFFD)    // brand-50 主色浅底
val VxinTeal = Color(0xFF17B8A6)          // 青碧辅助色（气泡渐变尾端）
// 兼容旧引用名（各 Screen 无需改动）：统一指向极光靛
val VxinGreen = VxinBrand
val VxinGreenDark = VxinBrandDark
val VxinBg = Color(0xFFF7F7F7)            // 浅灰壳层，对齐 web
val VxinTextPrimary = Color(0xFF1A1A1A)   // 正文近黑，对齐 web --text-primary
val VxinTextSecondary = Color(0xFF888888) // 辅助中性灰，对齐 web --text-secondary
val VxinError = Color(0xFFFA5151)

// 语义色（对齐 web --color-success / 支付绿 / 通话接听）
val VxinSuccess = Color(0xFF00B42A)       // 成功/正向（对齐 web --color-success #00B42A）：钱包入账、通话接听
val VxinSuccessDark = Color(0xFF059C4B)   // 成功按下态
// 支付/转账金钱主题绿（微信支付经典绿，对齐 web --pay-grad）：转账卡片渐变
val VxinPay = Color(0xFF07C160)
val VxinPayDark = Color(0xFF059C4B)       // 支付绿按下态/渐变深端（原 TransferGreenDark）
val VxinPayGradStart = Color(0xFF09BB07)
val VxinPayGradEnd = Color(0xFF07C160)

// 聊天气泡（对齐 web AURORA）：我的=极光靛渐变 + 白字；对方=白 + 深字
val VxinBubbleMine = VxinBrand            // 我方气泡主色（渐变见 ChatScreen bubbleBrush）
val VxinBubbleMineText = Color(0xFFFFFFFF) // 靛底白字，保证对比度（WCAG AA）
val VxinBubbleText = Color(0xFF1A1A1A)
val VxinBubbleOtherDark = Color(0xFF26262A)   // 暗色下对方气泡
val VxinBubbleTextDark = Color(0xFFE5E5E5)    // 暗色下对方气泡文字

// 深色模式壳层（对齐微信深色：近黑背景 + 深灰卡面）
val VxinBgDark = Color(0xFF111111)            // 深色背景
val VxinSurfaceDark = Color(0xFF1E1E1E)       // 深色卡面/顶栏
val VxinTextPrimaryDark = Color(0xFFE5E5E5)   // 深色正文
val VxinTextSecondaryDark = Color(0xFF9A9A9A) // 深色辅助文字
