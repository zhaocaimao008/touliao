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
