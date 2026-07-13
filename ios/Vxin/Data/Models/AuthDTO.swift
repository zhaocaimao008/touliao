import Foundation

struct LoginBody: Encodable {
    let phone: String
    let password: String
}

struct RegisterBody: Encodable {
    let phone: String
    let password: String
    let username: String
    let inviteCode: String   // 后端必填:6位数字邀请码,缺失则注册400
}

/// POST /api/auth/reset-password 请求体
struct ResetPasswordBody: Encodable {
    let phone: String
    let inviteCode: String
    let newPassword: String
}

/// POST /api/auth/login | /register 响应
struct AuthResponse: Decodable {
    let token: String
    let user: User
}

/// 后端统一错误体 { "error": "..." }
struct APIErrorBody: Decodable {
    let error: String?
}

/// 无响应体接口（如 logout）占位
struct EmptyResponse: Decodable {}

/// 登录设备/会话（GET /api/auth/sessions），current=当前设备。
struct DeviceSession: Decodable, Identifiable {
    let id: String
    let device: String
    let platform: String
    let ip: String
    let lastSeen: Double
    let current: Bool

    enum CodingKeys: String, CodingKey {
        case id, device, platform, ip, current
        case lastSeen = "last_seen"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        device = (try? c.decode(String.self, forKey: .device)) ?? ""
        platform = (try? c.decode(String.self, forKey: .platform)) ?? ""
        ip = (try? c.decode(String.self, forKey: .ip)) ?? ""
        lastSeen = (try? c.decode(Double.self, forKey: .lastSeen)) ?? 0
        current = (try? c.decode(Bool.self, forKey: .current)) ?? false
    }
}
