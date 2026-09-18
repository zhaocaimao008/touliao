package com.touliao.app.ui

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
 * 投聊 自绘品牌图标集（对齐 Web 线性图标风格，圆润 24dp 网格）。
 * 全部走 currentColor（tint 由调用方 Icon 的 tint 决定），
 * 取代早期 Material 通用图标（Email/DateRange/Star）与文本字符（▦）。
 */
object LegacyBusinessIcons {

    private fun stroke(name: String, block: androidx.compose.ui.graphics.vector.ImageVector.Builder.() -> Unit): ImageVector =
        ImageVector.Builder(
            name = name, defaultWidth = 24.dp, defaultHeight = 24.dp,
            viewportWidth = 24f, viewportHeight = 24f,
        ).apply { block() }.build()

    private fun ImageVector.Builder.line(pathData: androidx.compose.ui.graphics.vector.PathBuilder.() -> Unit) {
        path(
            fill = null,
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 1.8f,
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

    // The supplied kit does not include a stop-recording or keyboard symbol.
    val Stop: ImageVector by lazy {
        stroke("Stop") { solid { moveTo(6f, 6f); lineTo(18f, 6f); lineTo(18f, 18f); lineTo(6f, 18f); close() } }
    }
    val Keyboard: ImageVector by lazy {
        stroke("Keyboard") {
            line { moveTo(3f, 5f); lineTo(21f, 5f); lineTo(21f, 19f); lineTo(3f, 19f); close() }
            line { moveTo(7f, 15f); lineTo(17f, 15f) }
            for (y in listOf(9f, 12f)) for (x in listOf(7f, 10f, 13f, 16f)) {
                line { moveTo(x, y); lineTo(x + .1f, y) }
            }
        }
    }

    val Wallet: ImageVector by lazy {
        stroke("Wallet") {
            line {
                moveTo(3f, 6f); arcToRelative(2f, 2f, 0f, false, true, 2f, -2f)
                lineTo(19f, 4f); arcToRelative(2f, 2f, 0f, false, true, 2f, 2f)
                lineTo(21f, 18f); arcToRelative(2f, 2f, 0f, false, true, -2f, 2f)
                lineTo(5f, 20f); arcToRelative(2f, 2f, 0f, false, true, -2f, -2f); close()
            }
            line { moveTo(3f, 10f); lineTo(21f, 10f) }
            line { moveTo(16f, 15f); lineToRelative(0.01f, 0f) }
        }
    }
    val Ticket: ImageVector by lazy {
        stroke("Ticket") {
            line {
                moveTo(3f, 8f); arcToRelative(2f, 2f, 0f, false, true, 2f, -2f)
                lineTo(19f, 6f); arcToRelative(2f, 2f, 0f, false, true, 2f, 2f)
                lineTo(21f, 9.5f)
                curveToRelative(-1.1f, 0f, -2f, 0.9f, -2f, 2f); reflectiveCurveToRelative(0.9f, 2f, 2f, 2f)
                lineTo(21f, 16f); arcToRelative(2f, 2f, 0f, false, true, -2f, 2f)
                lineTo(5f, 18f); arcToRelative(2f, 2f, 0f, false, true, -2f, -2f)
                lineTo(3f, 13.5f)
                curveToRelative(1.1f, 0f, 2f, -0.9f, 2f, -2f); reflectiveCurveToRelative(-0.9f, -2f, -2f, -2f); close()
            }
            line { moveTo(10f, 6f); lineTo(10f, 18f) }
        }
    }
}
