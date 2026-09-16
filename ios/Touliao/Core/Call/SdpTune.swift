import Foundation

/// 弱网调优：给 SDP 里的 Opus 编码加 FEC(前向纠错) + 限最大码率，减少弱网下丢包造成的
/// 卡顿/爆音。CallManager（单聊）和 GroupCallManager（群聊）此前各自维护一份完全相同的
/// 实现（Android 同理，见 core/call/SdpTune.kt），Web 端已经是共享模块（utils/sdpTune.js）——
/// 这里补齐 iOS 这一份，避免以后改一处漏改另一处。
func tuneSdpForWeakNetwork(_ sdp: String) -> String {
    guard let range = sdp.range(of: #"a=rtpmap:(\d+) opus/48000/2"#, options: .regularExpression) else { return sdp }
    let pt = sdp[range].split(separator: " ").first!.split(separator: ":").last!
    let params = "useinbandfec=1;maxaveragebitrate=64000;stereo=0"
    let fmtpPattern = "a=fmtp:\(pt)[^\r\n]*"
    if let fmtpRange = sdp.range(of: fmtpPattern, options: .regularExpression) {
        let existing = sdp[fmtpRange].replacingOccurrences(of: "^a=fmtp:\(pt)\\s*", with: "", options: .regularExpression)
        var out: [String] = []
        var seen = Set<String>()
        let parts = (existing.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } + params.split(separator: ";").map(String.init))
        for p in parts {
            let key = p.split(separator: "=").first.map(String.init) ?? p
            if seen.insert(key).inserted { out.append(p) }
        }
        return sdp.replacingCharacters(in: fmtpRange, with: "a=fmtp:\(pt) \(out.joined(separator: ";"))")
    }
    // 无 fmtp 行（罕见）：在 rtpmap 后补一行
    if let lineRange = sdp.range(of: #"a=rtpmap:\d+ opus/48000/2\r?\n"#, options: .regularExpression) {
        return sdp.replacingCharacters(in: lineRange, with: sdp[lineRange] + "a=fmtp:\(pt) \(params)\r\n")
    }
    return sdp
}

/// A-2（2026-09-05）：视频编码 H264 优先。原生 libwebrtc 默认 offer 顺序里 VP8/VP9 排在
/// H264 前，而部分设备 VP8 硬编不可用，跨端互通会落到软编（卡顿/发热）。这里把本地生成的
/// offer/answer 里 m=video 段的 H264 payload 提到最前：重排 m= 行的 payload 顺序（对端按
/// 声明顺序选第一个双方都支持的编码），并把 H264 的 rtpmap/rtcp-fb/fmtp 属性行整体前移到
/// m= 行之后（纯整洁考虑，属性行顺序本身不影响语义）。
/// 安全：纯字符串重排，任何校验不过（无 m=video 段、无 H264、m= 行 payload 不足）都原样
/// 返回；只允许处理本端 setLocalDescription 前的 sdp（远端 sdp 不得 munge）。
/// 群（GroupCallManager）与 1v1（CallManager）经 [tuneSdpForCall] 共用，自动覆盖。
func preferH264VideoCodec(_ sdp: String) -> String {
    guard sdp.contains("\r\n") else { return sdp }
    let lines = sdp.components(separatedBy: "\r\n")
    guard let mIdx = lines.firstIndex(where: { $0.hasPrefix("m=video ") }) else { return sdp }
    let sectionEnd = lines[(mIdx + 1)...].firstIndex(where: { $0.hasPrefix("m=") }) ?? lines.count
    let mParts = lines[mIdx].components(separatedBy: " ")
    guard mParts.count >= 4 else { return sdp }
    let pts = Array(mParts.dropFirst(3))
    let section = Array(lines[(mIdx + 1)..<sectionEnd])

    // 段内 rtpmap:H264 的 payload 集合（形如 a=rtpmap:99 H264/90000）
    let h264Pts = Set(section.compactMap { line -> String? in
        let parts = line.components(separatedBy: " ")
        guard parts.count >= 2, parts[0].hasPrefix("a=rtpmap:"), parts[1].hasPrefix("H264/") else { return nil }
        return String(parts[0].dropFirst("a=rtpmap:".count))
    })
    guard !h264Pts.isEmpty else { return sdp }

    // m= 行 payload 重排：H264 在前，其余保持原相对顺序；集合与数量守恒校验（只重排不增删）
    let reordered = pts.filter { h264Pts.contains($0) } + pts.filter { !h264Pts.contains($0) }
    guard reordered.count == pts.count, Set(reordered) == Set(pts) else { return sdp }

    // 段内属性行的 payload（a=rtpmap/rtcp-fb/fmtp:PT ...），用于识别 H264 的属性行
    func attrPt(_ line: String) -> String? {
        for prefix in ["a=rtpmap:", "a=rtcp-fb:", "a=fmtp:"] where line.hasPrefix(prefix) {
            let pt = line.dropFirst(prefix.count).prefix(while: { $0.isNumber })
            return pt.isEmpty ? nil : String(pt)
        }
        return nil
    }
    // H264 的 rtpmap/rtcp-fb/fmtp 属性行整体前移（段内相对顺序不变），其余行原序跟在后面
    let h264Attrs = section.filter { attrPt($0).map { h264Pts.contains($0) } == true }
    let others = section.filter { attrPt($0).map { h264Pts.contains($0) } != true }

    let newMLine = (Array(mParts.prefix(3)) + reordered).joined(separator: " ")
    let newLines = Array(lines[..<mIdx]) + [newMLine] + h264Attrs + others + Array(lines[sectionEnd...])
    return newLines.joined(separator: "\r\n")
}

/// CallManager/GroupCallManager 共用的 sdp 调优入口：弱网 Opus 调优 + H264 优先（A-2）。
func tuneSdpForCall(_ sdp: String) -> String {
    preferH264VideoCodec(tuneSdpForWeakNetwork(sdp))
}
