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
