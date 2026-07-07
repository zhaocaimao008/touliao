package com.vxin.app.core.util

import java.util.Calendar
import java.util.Locale

/**
 * 聊天/会话时间显示（对齐微信）：
 * 今天 → HH:mm；昨天 → 昨天 HH:mm；本周内 → 周X HH:mm；
 * 今年更早 → M月d日 HH:mm；跨年 → yyyy年M月d日 HH:mm
 */
fun formatChatTime(epochSeconds: Long?): String {
    if (epochSeconds == null || epochSeconds <= 0) return ""
    val cal = Calendar.getInstance().apply { timeInMillis = epochSeconds * 1000L }
    val now = Calendar.getInstance()
    val hm = String.format(Locale.getDefault(), "%02d:%02d",
        cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE))
    val sameYear = now.get(Calendar.YEAR) == cal.get(Calendar.YEAR)

    fun startOfDay(c: Calendar): Long {
        val x = c.clone() as Calendar
        x.set(Calendar.HOUR_OF_DAY, 0); x.set(Calendar.MINUTE, 0)
        x.set(Calendar.SECOND, 0); x.set(Calendar.MILLISECOND, 0)
        return x.timeInMillis
    }
    val dayDiff = ((startOfDay(now) - startOfDay(cal)) / (24 * 3600 * 1000L)).toInt()

    return when {
        dayDiff == 0 -> hm
        dayDiff == 1 -> "昨天 $hm"
        dayDiff in 2..6 -> {
            val week = arrayOf("周日", "周一", "周二", "周三", "周四", "周五", "周六")
            "${week[cal.get(Calendar.DAY_OF_WEEK) - 1]} $hm"
        }
        sameYear -> "${cal.get(Calendar.MONTH) + 1}月${cal.get(Calendar.DAY_OF_MONTH)}日 $hm"
        else -> "${cal.get(Calendar.YEAR)}年${cal.get(Calendar.MONTH) + 1}月${cal.get(Calendar.DAY_OF_MONTH)}日 $hm"
    }
}
