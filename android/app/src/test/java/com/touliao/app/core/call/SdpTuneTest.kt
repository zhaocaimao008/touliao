package com.touliao.app.core.call

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** A-2：SDP H264 优先排序（preferH264VideoCodec）纯字符串逻辑的单测。 */
class SdpTuneTest {

    private val sample = listOf(
        "v=0",
        "o=- 46117317 2 IN IP4 127.0.0.1",
        "s=-",
        "t=0 0",
        "a=group:BUNDLE 0 1",
        "m=audio 9 UDP/TLS/RTP/SAVPF 111 103",
        "a=rtpmap:111 opus/48000/2",
        "a=fmtp:111 useinbandfec=1",
        "m=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 100 101",
        "a=rtpmap:96 VP8/90000",
        "a=rtcp-fb:96 goog-remb",
        "a=rtpmap:97 rtx/90000",
        "a=fmtp:97 apt=96",
        "a=rtpmap:98 VP9/90000",
        "a=rtcp-fb:98 transport-cc",
        "a=rtpmap:99 H264/90000",
        "a=rtcp-fb:99 goog-remb",
        "a=fmtp:99 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
        "a=rtpmap:100 H264/90000",
        "a=fmtp:100 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f",
        "a=rtpmap:101 red/90000",
        "a=extmap:3 http://www.webrtc.org/experiments/rtp-hdrext/color-space",
    ).joinToString("\r\n") + "\r\n"

    private fun lines(sdp: String) = sdp.split("\r\n")

    @Test
    fun h264PayloadsMoveToFrontOfMLine() {
        val out = preferH264VideoCodec(sample)
        val mLine = lines(out).first { it.startsWith("m=video ") }
        // H264(99/100) 在最前，非 H264 保持原相对顺序（96 97 98 101）
        assertEquals("m=video 9 UDP/TLS/RTP/SAVPF 99 100 96 97 98 101", mLine)
    }

    @Test
    fun h264AttributeLinesGroupedRightAfterMLine() {
        val out = preferH264VideoCodec(sample)
        val ls = lines(out)
        val mIdx = ls.indexOfFirst { it.startsWith("m=video ") }
        // m= 行之后紧跟 5 条 H264 属性行（rtpmap/fb/fmtp/rtpmap/fmtp，段内原相对顺序）
        assertEquals("a=rtpmap:99 H264/90000", ls[mIdx + 1])
        assertEquals("a=rtcp-fb:99 goog-remb", ls[mIdx + 2])
        assertEquals("a=fmtp:99 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f", ls[mIdx + 3])
        assertEquals("a=rtpmap:100 H264/90000", ls[mIdx + 4])
        assertEquals("a=fmtp:100 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f", ls[mIdx + 5])
    }

    @Test
    fun lineCountAndSetPreserved() {
        val out = preferH264VideoCodec(sample)
        assertEquals(lines(sample).size, lines(out).size)   // 只重排不增删行
        // payload 集合一致（m= 行）
        val ptsOf = { s: String ->
            lines(s).first { it.startsWith("m=video ") }.split(" ").drop(3).toSet()
        }
        assertEquals(ptsOf(sample), ptsOf(out))
        // 属性行集合一致（顺序无关；m= 行内容本身会变，排除在外）
        val attrsOf = { s: String -> lines(s).filter { !it.startsWith("m=") }.toSet() }
        assertEquals(attrsOf(sample), attrsOf(out))
    }

    @Test
    fun audioSectionUntouched() {
        val out = preferH264VideoCodec(sample)
        val audioIdx = lines(out).indexOfFirst { it.startsWith("m=audio ") }
        assertEquals("a=rtpmap:111 opus/48000/2", lines(out)[audioIdx + 1])
        val audioPt = lines(out).first { it.startsWith("m=audio ") }
        assertEquals("m=audio 9 UDP/TLS/RTP/SAVPF 111 103", audioPt)
    }

    @Test
    fun noH264ReturnsUnchanged() {
        val noH264 = sample.replace("H264/90000", "AV1/90000")
        assertEquals(noH264, preferH264VideoCodec(noH264))
    }

    @Test
    fun noVideoSectionReturnsUnchanged() {
        val audioOnly = lines(sample).takeWhile { !it.startsWith("m=video ") }.joinToString("\r\n")
        assertEquals(audioOnly, preferH264VideoCodec(audioOnly))
    }

    @Test
    fun lfOnlySdpReturnsUnchanged() {
        val lfOnly = sample.replace("\r\n", "\n")
        assertEquals(lfOnly, preferH264VideoCodec(lfOnly))
    }

    @Test
    fun idempotent() {
        val once = preferH264VideoCodec(sample)
        assertEquals(once, preferH264VideoCodec(once))
    }

    @Test
    fun composeWithWeakNetworkTune() {
        val out = tuneSdpForCall(sample)
        // 两项调优叠加：opus fmtp 合并弱网参数 + H264 已前移
        assertTrue(out.contains("useinbandfec=1"))
        assertTrue(out.contains("maxaveragebitrate=64000"))
        val mLine = lines(out).first { it.startsWith("m=video ") }
        assertTrue(mLine.endsWith("99 100 96 97 98 101"))
    }
}
