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

/**
 * A-2（2026-09-05）：视频编码 H264 优先。原生 libwebrtc 默认 offer 顺序里 VP8/VP9 排在
 * H264 前，而部分设备 VP8 硬编不可用，跨端互通会落到软编（卡顿/发热）。这里把本地生成的
 * offer/answer 里 m=video 段的 H264 payload 提到最前：重排 m= 行的 payload 顺序（对端按
 * 声明顺序选第一个双方都支持的编码），并把 H264 的 rtpmap/rtcp-fb/fmtp 属性行整体前移到
 * m= 行之后（纯整洁考虑，属性行顺序本身不影响语义）。
 * 安全：纯字符串重排，任何校验不过（无 m=video 段、无 H264、payload 集合/行数发生变化）
 * 都原样返回；只允许处理本端 setLocalDescription 前的 sdp（远端 sdp 不得 munge）。
 * 群（GroupCallManager）与 1v1（CallManager）经 [tuneSdpForCall] 共用，自动覆盖。
 */
fun preferH264VideoCodec(sdp: String): String {
    if (!sdp.contains("\r\n")) return sdp
    val lines = sdp.split("\r\n")
    val mIdx = lines.indexOfFirst { it.startsWith("m=video ") }
    if (mIdx < 0) return sdp
    val sectionEnd = (mIdx + 1 until lines.size).firstOrNull { lines[it].startsWith("m=") } ?: lines.size
    val mLineParts = lines[mIdx].split(" ")
    if (mLineParts.size < 4) return sdp
    val pts = mLineParts.drop(3)

    val h264Pts = lines.subList(mIdx + 1, sectionEnd)
        .mapNotNull { Regex("^a=rtpmap:(\\d+) H264/").find(it)?.groupValues?.get(1) }
    if (h264Pts.isEmpty()) return sdp
    val h264Set = h264Pts.toSet()

    // m= 行 payload 重排：H264 在前，其余保持原相对顺序；集合与数量必须与原来完全一致
    val reordered = pts.filter { it in h264Set } + pts.filter { it !in h264Set }
    if (reordered.size != pts.size || reordered.toSet() != pts.toSet()) return sdp

    // H264 的 rtpmap/rtcp-fb/fmtp 属性行整体前移（段内相对顺序不变），其余行原序跟在后面
    val attrRe = Regex("^a=(?:rtpmap|rtcp-fb|fmtp):(\\d+) ")
    val h264Attrs = lines.subList(mIdx + 1, sectionEnd).filter { l ->
        val ptOf = attrRe.find(l)?.groupValues?.get(1)
        ptOf != null && ptOf in h264Set
    }
    val others = lines.subList(mIdx + 1, sectionEnd).filterNot { it in h264Attrs }
    val newSection = listOf((mLineParts.take(3) + reordered).joinToString(" ")) + h264Attrs + others
    if (newSection.size != sectionEnd - mIdx) return sdp   // 行数守恒：只重排不增删

    return (lines.subList(0, mIdx) + newSection + lines.subList(sectionEnd, lines.size)).joinToString("\r\n")
}

/** CallManager/GroupCallManager 共用的 sdp 调优入口：弱网 Opus 调优 + H264 优先（A-2）。 */
fun tuneSdpForCall(sdp: String): String = preferH264VideoCodec(tuneSdpForWeakNetwork(sdp))
