package com.vxin.app.ui

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.Color

/**
 * v信 自绘品牌图标集（对齐 Web 线性图标风格，圆润 24dp 网格）。
 * 全部走 currentColor（tint 由调用方 Icon 的 tint 决定），
 * 取代早期 Material 通用图标（Email/DateRange/Star）与文本字符（▦）。
 */
object VxinIcons {

    private fun stroke(name: String, block: androidx.compose.ui.graphics.vector.ImageVector.Builder.() -> Unit): ImageVector =
        ImageVector.Builder(
            name = name, defaultWidth = 24.dp, defaultHeight = 24.dp,
            viewportWidth = 24f, viewportHeight = 24f,
        ).apply { block() }.build()

    private fun ImageVector.Builder.line(pathData: androidx.compose.ui.graphics.vector.PathBuilder.() -> Unit) {
        path(
            fill = null,
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 1.9f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
            pathBuilder = pathData,
        )
    }

    private fun ImageVector.Builder.solid(pathData: androidx.compose.ui.graphics.vector.PathBuilder.() -> Unit) {
        path(
            fill = SolidColor(Color.Black),
            pathFillType = PathFillType.NonZero,
            pathBuilder = pathData,
        )
    }

    /** 消息：圆角对话气泡 */
    val Chat: ImageVector by lazy {
        stroke("Chat") {
            line {
                moveTo(4f, 6f); arcToRelative(2f, 2f, 0f, false, true, 2f, -2f)
                lineTo(18f, 4f); arcToRelative(2f, 2f, 0f, false, true, 2f, 2f)
                lineTo(20f, 15f); arcToRelative(2f, 2f, 0f, false, true, -2f, 2f)
                lineTo(9f, 17f); lineToRelative(-4f, 3.5f); lineTo(5f, 17f)
                arcToRelative(2f, 2f, 0f, false, true, -1f, -1.7f); close()
            }
            line { moveTo(8.5f, 9.5f); lineToRelative(0.01f, 0f) }
            line { moveTo(12f, 9.5f); lineToRelative(0.01f, 0f) }
            line { moveTo(15.5f, 9.5f); lineToRelative(0.01f, 0f) }
        }
    }

    /** 通讯录：人 + 列表条 */
    val Contacts: ImageVector by lazy {
        stroke("Contacts") {
            line {
                moveTo(5f, 4f); lineTo(17f, 4f); arcToRelative(2f, 2f, 0f, false, true, 2f, 2f)
                lineTo(19f, 18f); arcToRelative(2f, 2f, 0f, false, true, -2f, 2f)
                lineTo(5f, 20f); close()
            }
            line { moveTo(5f, 4f); lineToRelative(0f, 16f) }
            line { moveTo(11f, 11f); moveToRelative(-2.2f, 0f); arcToRelative(2.2f, 2.2f, 0f, true, true, 4.4f, 0f); arcToRelative(2.2f, 2.2f, 0f, true, true, -4.4f, 0f) }
            line { moveTo(8f, 16.5f); curveToRelative(0.5f, -1.6f, 1.7f, -2.3f, 3f, -2.3f); reflectiveCurveToRelative(2.5f, 0.7f, 3f, 2.3f) }
        }
    }

    /** 我：圆内人像 */
    val Me: ImageVector by lazy {
        stroke("Me") {
            line { moveTo(12f, 12f); moveToRelative(-9f, 0f); arcToRelative(9f, 9f, 0f, true, true, 18f, 0f); arcToRelative(9f, 9f, 0f, true, true, -18f, 0f) }
            line { moveTo(12f, 11f); moveToRelative(-2.6f, 0f); arcToRelative(2.6f, 2.6f, 0f, true, true, 5.2f, 0f); arcToRelative(2.6f, 2.6f, 0f, true, true, -5.2f, 0f) }
            line { moveTo(6.5f, 18.5f); curveToRelative(0.8f, -2.2f, 2.9f, -3.3f, 5.5f, -3.3f); reflectiveCurveToRelative(4.7f, 1.1f, 5.5f, 3.3f) }
        }
    }

    /** 二维码：四角定位 + 点阵（取代 ▦ 文本字符） */
    val QrCode: ImageVector by lazy {
        stroke("QrCode") {
            // 左上定位框
            line { moveTo(4f, 6f); arcToRelative(2f, 2f, 0f, false, true, 2f, -2f); lineTo(9f, 4f); lineTo(9f, 9f); lineTo(4f, 9f); close() }
            // 右上定位框
            line { moveTo(15f, 4f); lineTo(18f, 4f); arcToRelative(2f, 2f, 0f, false, true, 2f, 2f); lineTo(20f, 9f); lineTo(15f, 9f); close() }
            // 左下定位框
            line { moveTo(4f, 15f); lineTo(9f, 15f); lineTo(9f, 20f); lineTo(6f, 20f); arcToRelative(2f, 2f, 0f, false, true, -2f, -2f); close() }
            // 右下数据点
            line { moveTo(15f, 15f); lineTo(17f, 15f) }
            line { moveTo(20f, 15f); lineTo(20f, 17f) }
            line { moveTo(17f, 17f); lineTo(17f, 20f) }
            line { moveTo(20f, 20f); lineTo(20f, 20.01f) }
        }
    }

    /** 搜索 */
    val Search: ImageVector by lazy {
        stroke("Search") {
            line { moveTo(11f, 11f); moveToRelative(-6.5f, 0f); arcToRelative(6.5f, 6.5f, 0f, true, true, 13f, 0f); arcToRelative(6.5f, 6.5f, 0f, true, true, -13f, 0f) }
            line { moveTo(16f, 16f); lineTo(20.5f, 20.5f) }
        }
    }

    /** 添加/发起（加号圆） */
    val Add: ImageVector by lazy {
        stroke("Add") {
            line { moveTo(12f, 6f); lineTo(12f, 18f) }
            line { moveTo(6f, 12f); lineTo(18f, 12f) }
        }
    }
}
