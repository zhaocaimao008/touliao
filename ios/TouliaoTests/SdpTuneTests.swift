import XCTest
@testable import Touliao

/// A-2：SDP H264 优先排序（preferH264VideoCodec）纯字符串逻辑的单测（镜像 Android SdpTuneTest）。
final class SdpTuneTests: XCTestCase {

    private let sample: String = [
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
    ].joined(separator: "\r\n") + "\r\n"

    private func lines(_ sdp: String) -> [String] {
        sdp.components(separatedBy: "\r\n")
    }

    func testH264PayloadsMoveToFrontOfMLine() {
        let out = preferH264VideoCodec(sample)
        let mLine = lines(out).first { $0.hasPrefix("m=video ") }
        // H264(99/100) 在最前，非 H264 保持原相对顺序（96 97 98 101）
        XCTAssertEqual("m=video 9 UDP/TLS/RTP/SAVPF 99 100 96 97 98 101", mLine)
    }

    func testH264AttributeLinesGroupedRightAfterMLine() {
        let out = preferH264VideoCodec(sample)
        let ls = lines(out)
        let mIdx = ls.firstIndex { $0.hasPrefix("m=video ") }!
        // m= 行之后紧跟 5 条 H264 属性行（rtpmap/fb/fmtp/rtpmap/fmtp，段内原相对顺序）
        XCTAssertEqual("a=rtpmap:99 H264/90000", ls[mIdx + 1])
        XCTAssertEqual("a=rtcp-fb:99 goog-remb", ls[mIdx + 2])
        XCTAssertEqual("a=fmtp:99 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f", ls[mIdx + 3])
        XCTAssertEqual("a=rtpmap:100 H264/90000", ls[mIdx + 4])
        XCTAssertEqual("a=fmtp:100 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f", ls[mIdx + 5])
    }

    func testLineCountAndSetPreserved() {
        let out = preferH264VideoCodec(sample)
        XCTAssertEqual(lines(sample).count, lines(out).count)   // 只重排不增删行
        // payload 集合一致（m= 行）
        let ptsOf: (String) -> Set<String> = { s in
            Set(lines(s).first { $0.hasPrefix("m=video ") }!.components(separatedBy: " ").dropFirst(3))
        }
        XCTAssertEqual(ptsOf(sample), ptsOf(out))
        // 属性行集合一致（顺序无关；m= 行内容本身会变，排除在外）
        let attrsOf: (String) -> Set<String> = { s in
            Set(lines(s).filter { !$0.hasPrefix("m=") })
        }
        XCTAssertEqual(attrsOf(sample), attrsOf(out))
    }

    func testAudioSectionUntouched() {
        let out = preferH264VideoCodec(sample)
        let audioIdx = lines(out).firstIndex { $0.hasPrefix("m=audio ") }!
        XCTAssertEqual("a=rtpmap:111 opus/48000/2", lines(out)[audioIdx + 1])
        let audioM = lines(out).first { $0.hasPrefix("m=audio ") }
        XCTAssertEqual("m=audio 9 UDP/TLS/RTP/SAVPF 111 103", audioM)
    }

    func testNoH264ReturnsUnchanged() {
        let noH264 = sample.replacingOccurrences(of: "H264/90000", with: "AV1/90000")
        XCTAssertEqual(noH264, preferH264VideoCodec(noH264))
    }

    func testNoVideoSectionReturnsUnchanged() {
        let audioOnly = lines(sample).prefix { !$0.hasPrefix("m=video ") }.joined(separator: "\r\n")
        XCTAssertEqual(audioOnly, preferH264VideoCodec(audioOnly))
    }

    func testLfOnlySdpReturnsUnchanged() {
        let lfOnly = sample.replacingOccurrences(of: "\r\n", with: "\n")
        XCTAssertEqual(lfOnly, preferH264VideoCodec(lfOnly))
    }

    func testIdempotent() {
        let once = preferH264VideoCodec(sample)
        XCTAssertEqual(once, preferH264VideoCodec(once))
    }

    func testComposeWithWeakNetworkTune() {
        let out = tuneSdpForCall(sample)
        // 两项调优叠加：opus fmtp 合并弱网参数 + H264 已前移
        XCTAssertTrue(out.contains("useinbandfec=1"))
        XCTAssertTrue(out.contains("maxaveragebitrate=64000"))
        let mLine = lines(out).first { $0.hasPrefix("m=video ") }
        XCTAssertTrue(mLine!.hasSuffix("99 100 96 97 98 101"))
    }
}
