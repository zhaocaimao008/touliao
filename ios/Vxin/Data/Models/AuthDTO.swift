import Foundation

struct LoginBody: Encodable {
    let phone: String
    let password: String
}

struct RegisterBody: Encodable {
    let phone: String
    let password: String
    let username: String
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
