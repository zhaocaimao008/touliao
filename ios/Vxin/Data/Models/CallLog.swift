import Foundation

/// 通话记录（GET /api/users/me/call-logs）。对齐 web CallHistory / 后端 getCallLogs。
struct CallLog: Decodable, Identifiable {
    let id: String
    var type: String = "audio"        // audio | video
    var status: String = "completed"  // completed | missed | canceled | rejected | ongoing
    var direction: String = "out"     // out | in
    var duration: Int = 0             // 秒
    var startedAt: Double = 0
    var endedAt: Double = 0
    var createdAt: Double = 0
    var peerId: String = ""
    var peerName: String = ""
    var peerAvatar: String = ""

    enum CodingKeys: String, CodingKey {
        case id, type, status, direction, duration
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case createdAt = "created_at"
        case peerId = "peer_id"
        case peerName = "peer_name"
        case peerAvatar = "peer_avatar"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        type = (try? c.decode(String.self, forKey: .type)) ?? "audio"
        status = (try? c.decode(String.self, forKey: .status)) ?? "completed"
        direction = (try? c.decode(String.self, forKey: .direction)) ?? "out"
        duration = (try? c.decode(Int.self, forKey: .duration)) ?? 0
        startedAt = (try? c.decode(Double.self, forKey: .startedAt)) ?? 0
        endedAt = (try? c.decode(Double.self, forKey: .endedAt)) ?? 0
        createdAt = (try? c.decode(Double.self, forKey: .createdAt)) ?? 0
        peerId = (try? c.decode(String.self, forKey: .peerId)) ?? ""
        peerName = (try? c.decode(String.self, forKey: .peerName)) ?? ""
        peerAvatar = (try? c.decode(String.self, forKey: .peerAvatar)) ?? ""
    }
}
