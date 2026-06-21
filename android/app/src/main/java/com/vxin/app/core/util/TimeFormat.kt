package com.vxin.app.core.util

import java.util.Calendar

/** 会话列表/消息的时间显示：今天显示 HH:mm，更早显示 M月d日 */
fun formatChatTime(epochSeconds: Long?): String {
    if (epochSeconds == null || epochSeconds <= 0) return ""
    val cal = Calendar.getInstance().apply { timeInMillis = epochSeconds * 1000 }
    val now = Calendar.getInstance()
    val sameDay = cal.get(Calendar.YEAR) == now.get(Calendar.YEAR) &&
        cal.get(Calendar.DAY_OF_YEAR) == now.get(Calendar.DAY_OF_YEAR)
    return if (sameDay) {
        "%02d:%02d".format(cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE))
    } else {
        "${cal.get(Calendar.MONTH) + 1}月${cal.get(Calendar.DAY_OF_MONTH)}日"
    }
}
