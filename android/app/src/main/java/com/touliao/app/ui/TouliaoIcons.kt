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
object TouliaoIcons {

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

    /** 动态（相机） */
    val Moments: ImageVector by lazy {
        stroke("Moments") {
            line {
                moveTo(23f, 19f); arcToRelative(2f, 2f, 0f, false, true, -2f, 2f)
                lineTo(3f, 21f); arcToRelative(2f, 2f, 0f, false, true, -2f, -2f)
                lineTo(1f, 8f); arcToRelative(2f, 2f, 0f, false, true, 2f, -2f)
                lineTo(5.5f, 6f); lineTo(7f, 3f); lineTo(17f, 3f); lineTo(18.5f, 6f)
                lineTo(21f, 6f); arcToRelative(2f, 2f, 0f, false, true, 2f, 2f); close()
            }
            line { moveTo(12f, 12f); moveToRelative(-3.5f, 0f); arcToRelative(3.5f, 3.5f, 0f, true, true, 7f, 0f); arcToRelative(3.5f, 3.5f, 0f, true, true, -7f, 0f) }
        }
    }

    /** 右 chevron（用于设置行） */
    val ChevronRight: ImageVector by lazy {
        stroke("ChevronRight") {
            line { moveTo(9f, 6f); lineTo(15f, 12f); lineTo(9f, 18f) }
        }
    }

    /** 手机 */
    val Phone: ImageVector by lazy {
        stroke("Phone") {
            line {
                moveTo(6.6f, 10.8f)
                curveToRelative(1.4f, 2.8f, 3.8f, 5.1f, 6.6f, 6.6f)
                lineToRelative(2.2f, -2.2f)
                curveToRelative(0.3f, -0.3f, 0.7f, -0.4f, 1f, -0.2f)
                curveToRelative(1.1f, 0.4f, 2.3f, 0.6f, 3.6f, 0.6f)
                curveToRelative(0.6f, 0f, 1f, 0.4f, 1f, 1f)
                lineTo(21f, 19f)
                curveToRelative(0f, 0.6f, -0.4f, 1f, -1f, 1f)
                curveTo(11.2f, 20f, 4f, 12.8f, 4f, 5f)
                curveToRelative(0f, -0.6f, 0.4f, -1f, 1f, -1f)
                lineTo(8.6f, 4f)
                curveToRelative(0.6f, 0f, 1f, 0.4f, 1f, 1f)
                curveToRelative(0f, 1.3f, 0.2f, 2.5f, 0.6f, 3.6f)
                curveToRelative(0.1f, 0.3f, 0f, 0.7f, -0.2f, 1f)
                close()
            }
        }
    }

    /** 钱包 */
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

    /** 通话记录（带箭头电话） */
    val PhoneCall: ImageVector by lazy {
        stroke("PhoneCall") {
            line {
                moveTo(6.6f, 10.8f)
                curveToRelative(1.4f, 2.8f, 3.8f, 5.1f, 6.6f, 6.6f)
                lineToRelative(2.2f, -2.2f)
                curveToRelative(0.3f, -0.3f, 0.7f, -0.4f, 1f, -0.2f)
                curveToRelative(1.1f, 0.4f, 2.3f, 0.6f, 3.6f, 0.6f)
                curveToRelative(0.6f, 0f, 1f, 0.4f, 1f, 1f)
                lineTo(21f, 19f)
                curveToRelative(0f, 0.6f, -0.4f, 1f, -1f, 1f)
                curveTo(11.2f, 20f, 4f, 12.8f, 4f, 5f)
                curveToRelative(0f, -0.6f, 0.4f, -1f, 1f, -1f)
                lineTo(8.6f, 4f)
                curveToRelative(0.6f, 0f, 1f, 0.4f, 1f, 1f)
                curveToRelative(0f, 1.3f, 0.2f, 2.5f, 0.6f, 3.6f)
                curveToRelative(0.1f, 0.3f, 0f, 0.7f, -0.2f, 1f); close()
            }
            line { moveTo(16f, 4f); lineTo(20f, 4f); lineTo(20f, 8f) }
            line { moveTo(15f, 9f); lineTo(20f, 4f) }
        }
    }

    /** 登录设备 */
    val Devices: ImageVector by lazy {
        stroke("Devices") {
            line {
                moveTo(3f, 5f); arcToRelative(1f, 1f, 0f, false, true, 1f, -1f)
                lineTo(16f, 4f); arcToRelative(1f, 1f, 0f, false, true, 1f, 1f)
                lineTo(17f, 13f); arcToRelative(1f, 1f, 0f, false, true, -1f, 1f)
                lineTo(4f, 14f); arcToRelative(1f, 1f, 0f, false, true, -1f, -1f); close()
            }
            line { moveTo(7f, 20f); lineTo(13f, 20f) }
            line { moveTo(10f, 14f); lineTo(10f, 20f) }
            line {
                moveTo(18f, 11f); lineTo(20f, 11f); arcToRelative(1f, 1f, 0f, false, true, 1f, 1f)
                lineTo(21f, 19f); arcToRelative(1f, 1f, 0f, false, true, -1f, 1f)
                lineTo(18f, 20f)
            }
        }
    }

    /** 通知 Bell */
    val Bell: ImageVector by lazy {
        stroke("Bell") {
            line {
                moveTo(12f, 2f)
                curveToRelative(-3.9f, 0f, -7f, 3.1f, -7f, 7f)
                lineTo(5f, 15f); lineTo(3f, 17f); lineTo(21f, 17f); lineTo(19f, 15f); lineTo(19f, 9f)
                curveToRelative(0f, -3.9f, -3.1f, -7f, -7f, -7f); close()
            }
            line { moveTo(10f, 17f); curveToRelative(0f, 1.1f, 0.9f, 2f, 2f, 2f); reflectiveCurveToRelative(2f, -0.9f, 2f, -2f) }
        }
    }

    /** 隐私安全 ShieldCheck */
    val Shield: ImageVector by lazy {
        stroke("Shield") {
            line {
                moveTo(12f, 3f); lineTo(4f, 6f); lineTo(4f, 12f)
                curveToRelative(0f, 5f, 3.5f, 9.7f, 8f, 11f)
                curveToRelative(4.5f, -1.3f, 8f, -6f, 8f, -11f)
                lineTo(20f, 6f); close()
            }
            line { moveTo(9f, 12f); lineTo(11f, 14f); lineTo(15f, 10f) }
        }
    }

    /** 外观 Palette */
    val Palette: ImageVector by lazy {
        stroke("Palette") {
            line {
                moveTo(12f, 2f); moveToRelative(-9f, 0f)
                arcToRelative(9f, 9f, 0f, true, true, 18f, 0f)
                arcToRelative(9f, 9f, 0f, true, true, -18f, 0f)
            }
            line { moveTo(7f, 12f); lineToRelative(0.01f, 0f) }
            line { moveTo(10.5f, 8f); lineToRelative(0.01f, 0f) }
            line { moveTo(13.5f, 8f); lineToRelative(0.01f, 0f) }
            line { moveTo(17f, 12f); lineToRelative(0.01f, 0f) }
            line {
                moveTo(12f, 17f)
                curveToRelative(2f, 0f, 3.5f, -0.7f, 3.5f, -2f)
                arcToRelative(1.5f, 1.5f, 0f, false, false, -1.5f, -1.5f)
                lineTo(12f, 13.5f)
                arcToRelative(1.5f, 1.5f, 0f, false, false, -1.5f, 1.5f)
                curveToRelative(0f, 1.3f, 1.5f, 2f, 1.5f, 2f); close()
            }
        }
    }

    /** 邀请好友 UserPlus */
    val UserPlus: ImageVector by lazy {
        stroke("UserPlus") {
            line { moveTo(12f, 12f); moveToRelative(-4f, 0f); arcToRelative(4f, 4f, 0f, true, true, 8f, 0f); arcToRelative(4f, 4f, 0f, true, true, -8f, 0f) }
            line { moveTo(3f, 20f); curveToRelative(0f, -3.3f, 3.1f, -6f, 7f, -6f) }
            line { moveTo(17f, 13f); lineTo(17f, 19f) }
            line { moveTo(14f, 16f); lineTo(20f, 16f) }
        }
    }

    /** 切换账号 Users */
    val Users: ImageVector by lazy {
        stroke("Users") {
            line { moveTo(9f, 11f); moveToRelative(-3.5f, 0f); arcToRelative(3.5f, 3.5f, 0f, true, true, 7f, 0f); arcToRelative(3.5f, 3.5f, 0f, true, true, -7f, 0f) }
            line { moveTo(2f, 20f); curveToRelative(0f, -2.8f, 3.1f, -5f, 7f, -5f); reflectiveCurveToRelative(7f, 2.2f, 7f, 5f) }
            line { moveTo(16f, 7f); curveToRelative(1.9f, 0f, 3.5f, 1.6f, 3.5f, 3.5f); reflectiveCurveToRelative(-1.6f, 3.5f, -3.5f, 3.5f) }
            line { moveTo(19f, 15f); curveToRelative(1.8f, 0.5f, 3f, 1.8f, 3f, 3.3f) }
        }
    }

    /** 锁（密码字段） */
    val Lock: ImageVector by lazy {
        stroke("Lock") {
            line {
                moveTo(5f, 11f); arcToRelative(2f, 2f, 0f, false, true, 2f, -2f)
                lineTo(17f, 9f); arcToRelative(2f, 2f, 0f, false, true, 2f, 2f)
                lineTo(19f, 19f); arcToRelative(2f, 2f, 0f, false, true, -2f, 2f)
                lineTo(7f, 21f); arcToRelative(2f, 2f, 0f, false, true, -2f, -2f); close()
            }
            line { moveTo(8f, 9f); lineTo(8f, 6.5f); arcToRelative(4f, 4f, 0f, false, true, 8f, 0f); lineTo(16f, 9f) }
            line { moveTo(12f, 14f); lineToRelative(0f, 3f) }
        }
    }

    /** 睁眼（显示密码） */
    val Eye: ImageVector by lazy {
        stroke("Eye") {
            line {
                moveTo(1.5f, 12f)
                curveToRelative(1.8f, -4f, 5.6f, -6.5f, 10.5f, -6.5f)
                reflectiveCurveToRelative(8.7f, 2.5f, 10.5f, 6.5f)
                curveToRelative(-1.8f, 4f, -5.6f, 6.5f, -10.5f, 6.5f)
                reflectiveCurveToRelative(-8.7f, -2.5f, -10.5f, -6.5f); close()
            }
            line { moveTo(12f, 12f); moveToRelative(-2.6f, 0f); arcToRelative(2.6f, 2.6f, 0f, true, true, 5.2f, 0f); arcToRelative(2.6f, 2.6f, 0f, true, true, -5.2f, 0f) }
        }
    }

    /** 闭眼（隐藏密码） */
    val EyeOff: ImageVector by lazy {
        stroke("EyeOff") {
            line {
                moveTo(3.5f, 3.5f); lineTo(20.5f, 20.5f)
            }
            line {
                moveTo(6.4f, 6.6f)
                curveToRelative(-2f, 1.2f, -3.5f, 3.1f, -4.9f, 5.4f)
                curveToRelative(1.8f, 4f, 5.6f, 6.5f, 10.5f, 6.5f)
                curveToRelative(1.7f, 0f, 3.2f, -0.3f, 4.6f, -0.9f)
            }
            line {
                moveTo(9.9f, 5.2f)
                curveToRelative(0.7f, -0.1f, 1.4f, -0.2f, 2.1f, -0.2f)
                curveToRelative(4.9f, 0f, 8.7f, 2.5f, 10.5f, 6.5f)
                curveToRelative(-0.7f, 1.5f, -1.7f, 2.9f, -2.9f, 3.9f)
            }
            line { moveTo(9.9f, 10f); curveToRelative(-0.5f, 0.5f, -0.9f, 1.2f, -0.9f, 2f); curveToRelative(0f, 1.4f, 1.1f, 2.6f, 2.6f, 2.6f); curveToRelative(0.8f, 0f, 1.5f, -0.4f, 2f, -0.9f) }
        }
    }

    /** 邀请码（票据） */
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

    /** 圆内对勾（勾选框） */
    val Check: ImageVector by lazy {
        stroke("Check") {
            line { moveTo(5f, 12.5f); lineTo(9.5f, 17f); lineTo(19f, 6.5f) }
        }
    }

    /** 设置（齿轮） */
    val Gear: ImageVector by lazy {
        stroke("Gear") {
            line { moveTo(12f, 12f); moveToRelative(-3.2f, 0f); arcToRelative(3.2f, 3.2f, 0f, true, true, 6.4f, 0f); arcToRelative(3.2f, 3.2f, 0f, true, true, -6.4f, 0f) }
            line {
                moveTo(12f, 3f); lineToRelative(0.6f, 2.3f)
                moveTo(12f, 21f); lineToRelative(-0.6f, -2.3f)
                moveTo(3f, 12f); lineToRelative(2.3f, -0.6f)
                moveTo(21f, 12f); lineToRelative(-2.3f, 0.6f)
                moveTo(5.6f, 5.6f); lineToRelative(1.7f, 1.7f)
                moveTo(18.4f, 18.4f); lineToRelative(-1.7f, -1.7f)
                moveTo(18.4f, 5.6f); lineToRelative(-1.7f, 1.7f)
                moveTo(5.6f, 18.4f); lineToRelative(1.7f, -1.7f)
            }
        }
    }

    /** 清除缓存（垃圾桶） */
    val Trash: ImageVector by lazy {
        stroke("Trash") {
            line { moveTo(4f, 7f); lineTo(20f, 7f) }
            line { moveTo(9f, 7f); lineTo(9f, 4.5f); arcToRelative(1f, 1f, 0f, false, true, 1f, -1f); lineTo(14f, 3.5f); arcToRelative(1f, 1f, 0f, false, true, 1f, 1f); lineTo(15f, 7f) }
            line {
                moveTo(6f, 7f); lineTo(6.8f, 19.5f); arcToRelative(2f, 2f, 0f, false, false, 2f, 1.9f)
                lineTo(15.2f, 21.4f); arcToRelative(2f, 2f, 0f, false, false, 2f, -1.9f); lineTo(18f, 7f)
            }
            line { moveTo(10f, 11f); lineTo(10f, 17f) }
            line { moveTo(14f, 11f); lineTo(14f, 17f) }
        }
    }

    /** 关于（信息） */
    val Info: ImageVector by lazy {
        stroke("Info") {
            line { moveTo(12f, 12f); moveToRelative(-9f, 0f); arcToRelative(9f, 9f, 0f, true, true, 18f, 0f); arcToRelative(9f, 9f, 0f, true, true, -18f, 0f) }
            line { moveTo(12f, 11f); lineTo(12f, 16.5f) }
            line { moveTo(12f, 7.5f); lineToRelative(0.01f, 0f) }
        }
    }

    /** 收藏（五角星） */
    val Star: ImageVector by lazy {
        stroke("Star") {
            line {
                moveTo(12f, 3f)
                lineTo(14.6f, 8.9f); lineTo(21f, 9.6f)
                lineTo(16.2f, 13.9f); lineTo(17.6f, 20.2f)
                lineTo(12f, 16.9f); lineTo(6.4f, 20.2f)
                lineTo(7.8f, 13.9f); lineTo(3f, 9.6f)
                lineTo(9.4f, 8.9f); close()
            }
        }
    }

    /** 标签 */
    val Tag: ImageVector by lazy {
        stroke("Tag") {
            line {
                moveTo(3f, 12f); lineTo(3f, 5f); arcToRelative(2f, 2f, 0f, false, true, 2f, -2f)
                lineTo(12f, 3f); lineTo(21f, 12f); lineTo(12f, 21f); lineTo(3f, 12f); close()
            }
            line { moveTo(7.5f, 7.5f); moveToRelative(-0.01f, 0f) }
        }
    }

    /** 人像（昵称字段） */
    val Person: ImageVector by lazy {
        stroke("Person") {
            line { moveTo(12f, 12f); moveToRelative(-3.8f, 0f); arcToRelative(3.8f, 3.8f, 0f, true, true, 7.6f, 0f); arcToRelative(3.8f, 3.8f, 0f, true, true, -7.6f, 0f) }
            line { moveTo(5.5f, 20f); curveToRelative(0.9f, -3.3f, 3.4f, -5f, 6.5f, -5f); reflectiveCurveToRelative(5.6f, 1.7f, 6.5f, 5f) }
        }
    }
}
