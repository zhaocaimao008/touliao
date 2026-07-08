import Foundation

struct UpdateProfileBody: Encodable { let username: String?; let bio: String? }
struct ChangePasswordBody: Encodable { let oldPassword: String; let newPassword: String }
struct AvatarResponse: Decodable { let avatar: String }

/// 用户设置（GET /api/users/me/settings 子集）
struct UserSettings: Decodable {
    var chatBackground: String = ""
    var momentsVisibleDays: Int = 0
    enum CodingKeys: String, CodingKey { case chatBackground, momentsVisibleDays }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        chatBackground = (try? c.decode(String.self, forKey: .chatBackground)) ?? ""
        momentsVisibleDays = (try? c.decode(Int.self, forKey: .momentsVisibleDays)) ?? 0
    }
}
private struct UpdateSettingsBody: Encodable { let momentsVisibleDays: Int? }

/// 通知相关设置（GET/PUT /api/users/me/settings 的布尔子集）
struct NotificationSettings: Decodable {
    var messageNotify = true
    var sound = true
    var vibrate = false
    var detailPreview = true
    enum CodingKeys: String, CodingKey { case messageNotify, sound, vibrate, detailPreview }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        messageNotify = (try? c.decode(Bool.self, forKey: .messageNotify)) ?? true
        sound = (try? c.decode(Bool.self, forKey: .sound)) ?? true
        vibrate = (try? c.decode(Bool.self, forKey: .vibrate)) ?? false
        detailPreview = (try? c.decode(Bool.self, forKey: .detailPreview)) ?? true
    }
}
/// 仅编码非 nil 字段：后端 normalizeSettings 用 `!== undefined` 判定，
/// 若把 nil 编成 JSON null 会被当作 false 误关其他开关，故这里跳过 nil 键。
private struct UpdateNotificationBody: Encodable {
    let messageNotify: Bool?
    let sound: Bool?
    let vibrate: Bool?
    let detailPreview: Bool?

    enum CodingKeys: String, CodingKey { case messageNotify, sound, vibrate, detailPreview }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(messageNotify, forKey: .messageNotify)
        try c.encodeIfPresent(sound, forKey: .sound)
        try c.encodeIfPresent(vibrate, forKey: .vibrate)
        try c.encodeIfPresent(detailPreview, forKey: .detailPreview)
    }
}

/// 我的专属邀请码 + 邀请战绩（GET /api/users/me/invite）。容错解码，字段缺省不致失败。
struct InviteInfo: Decodable {
    var code: String = ""
    var invitedCount: Int = 0
    var invitees: [Invitee] = []
    enum CodingKeys: String, CodingKey { case code, invitedCount, invitees }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = (try? c.decode(String.self, forKey: .code)) ?? ""
        invitedCount = (try? c.decode(Int.self, forKey: .invitedCount)) ?? 0
        invitees = (try? c.decode([Invitee].self, forKey: .invitees)) ?? []
    }

    struct Invitee: Decodable, Identifiable {
        var id: String = ""
        var username: String = ""
        var avatar: String = ""
        enum CodingKeys: String, CodingKey { case id, username, avatar }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = (try? c.decode(String.self, forKey: .id)) ?? ""
            username = (try? c.decode(String.self, forKey: .username)) ?? ""
            avatar = (try? c.decode(String.self, forKey: .avatar)) ?? ""
        }
    }
}

/// 个人资料：更新昵称/签名、改密码、上传头像。与 Android ProfileRepository 等价。
final class ProfileRepository {
    static let shared = ProfileRepository()
    private init() {}

    private let api = APIClient.shared

    func updateProfile(username: String?, bio: String?) async throws -> User {
        try await api.send("api/users/profile", method: "PUT", body: UpdateProfileBody(username: username, bio: bio))
    }

    func changePassword(oldPassword: String, newPassword: String) async throws {
        let _: EmptyResponse = try await api.send(
            "api/auth/change-password", method: "PUT",
            body: ChangePasswordBody(oldPassword: oldPassword, newPassword: newPassword)
        )
    }

    func uploadAvatar(data: Data, fileName: String) async throws -> String {
        let res: AvatarResponse = try await api.upload(
            "api/users/avatar", fileData: data, fileName: fileName, mimeType: "image/jpeg", fieldName: "avatar"
        )
        return res.avatar
    }

    /// 我的二维码 PNG 字节（需 Bearer）
    func qrcodeData() async throws -> Data {
        try await api.fetchData("api/users/me/qrcode")
    }

    /// 我的专属邀请码 + 邀请战绩
    func myInvite() async throws -> InviteInfo {
        try await api.send("api/users/me/invite")
    }

    /// 通话记录（自己作为主叫/被叫，含对方资料 + 方向）
    func callLogs(limit: Int = 50) async throws -> [CallLog] {
        try await api.send("api/users/me/call-logs?limit=\(limit)")
    }

    // ── 个人设置 ──
    func settings() async throws -> UserSettings {
        try await api.send("api/users/me/settings")
    }

    /// 朋友圈"最近 N 天可见"：0=全部 / 1 / 3 / 30
    func setMomentsVisibleDays(_ days: Int) async throws {
        let _: UserSettings = try await api.send(
            "api/users/me/settings", method: "PUT", body: UpdateSettingsBody(momentsVisibleDays: days)
        )
    }

    // ── 通知设置 ──
    func notificationSettings() async throws -> NotificationSettings {
        try await api.send("api/users/me/settings")
    }

    /// 更新通知开关（仅传非 nil 字段）
    func updateNotificationSettings(messageNotify: Bool? = nil, sound: Bool? = nil,
                                    vibrate: Bool? = nil, detailPreview: Bool? = nil) async throws {
        let _: NotificationSettings = try await api.send(
            "api/users/me/settings", method: "PUT",
            body: UpdateNotificationBody(messageNotify: messageNotify, sound: sound, vibrate: vibrate, detailPreview: detailPreview)
        )
    }
}
