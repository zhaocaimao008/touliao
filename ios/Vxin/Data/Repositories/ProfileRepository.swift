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
}
