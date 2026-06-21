import Foundation

struct DeviceTokenBody: Encodable {
    let token: String
    let platform: String
}

struct DeleteTokenBody: Encodable {
    let token: String
}

/// 设备 token 注册/注销。与 Android NotificationApi 等价。
final class NotificationRepository {
    static let shared = NotificationRepository()
    private init() {}

    private let api = APIClient.shared

    func register(token: String) async {
        let _: EmptyResponse? = try? await api.send(
            "api/notifications/device-token", method: "POST",
            body: DeviceTokenBody(token: token, platform: "ios")
        )
    }

    func delete(token: String) async {
        let _: EmptyResponse? = try? await api.send(
            "api/notifications/device-token", method: "DELETE",
            body: DeleteTokenBody(token: token)
        )
    }
}
