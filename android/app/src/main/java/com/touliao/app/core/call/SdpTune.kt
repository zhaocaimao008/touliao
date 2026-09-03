package com.touliao.app.core.call

/**
 * 弱网调优：给 SDP 里的 Opus 编码加 FEC(前向纠错) + 限最大码率，减少弱网下丢包造成的
 * 卡顿/爆音。CallManager（单聊）和 GroupCallManager（群聊）此前各自维护一份完全相同的
 * 实现，iOS 同理（CallManager.swift / GroupCallManager.swift），Web 端已经是共享模块
 * （utils/sdpTune.js）——这里补齐 Android 这一份，避免以后改一处漏改另一处（这正是
 * 本会话修的 2ada4fd 多端同步 bug 的成因模式：同一逻辑分散维护，改动没同步到位）。
 */
fun tuneSdpForWeakNetwork(sdp: String): String {
    val m = Regex("a=rtpmap:(\\d+) opus/48000/2").find(sdp) ?: return sdp
    val pt = m.groupValues[1]
    val params = "useinbandfec=1;maxaveragebitrate=64000;stereo=0"
    val fmtpRe = Regex("a=fmtp:$pt[^\\r\\n]*")
    val existingFmtp = fmtpRe.find(sdp) ?: return sdp.replace(
        Regex("(a=rtpmap:$pt opus/48000/2\\r?\\n)"),
        "$1a=fmtp:$pt $params\r\n"
    )
    val existing = existingFmtp.value.replace(Regex("^a=fmtp:$pt\\s*"), "")
    val out = mutableListOf<String>()
    val seen = mutableSetOf<String>()
    for (p in (existing.split(';').map { it.trim() }.filter { it.isNotEmpty() } + params.split(';'))) {
        val key = p.substringBefore('=')
        if (seen.add(key)) out.add(p)
    }
    return sdp.replace(existingFmtp.value, "a=fmtp:$pt ${out.joinToString(";")}")
}
