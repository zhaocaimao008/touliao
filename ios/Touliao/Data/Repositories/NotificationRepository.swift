import Foundation

struct DeviceTokenBody: Encodable {
    let token: String
    let platform: String
}

struct DeleteTokenBody: Encodable {
    let token: String?
}

/// 设备 token 注册/注销。与 Android NotificationApi 等价。
final class NotificationRepository {
    static let shared = NotificationRepository()
    private init() {}

    private let api = APIClient.shared

    func register(token: String, platform: String = "ios", owner: KeychainStore.Snapshot) async {
        let _: EmptyResponse? = try? await api.send(
            "api/notifications/device-token", method: "POST",
            body: DeviceTokenBody(token: token, platform: platform), owner: owner
        )
    }

    func deleteAll(owner: KeychainStore.Snapshot) async {
        let _: EmptyResponse? = try? await api.send(
            "api/notifications/device-token", method: "DELETE",
            body: DeleteTokenBody(token: nil), owner: owner
        )
    }

    /// [诊断] 上报推送注册状态（排查锁屏无通知）
    func diag(_ message: String) async {
        struct DiagBody: Encodable { let message: String }
        let _: EmptyResponse? = try? await api.send(
            "api/notifications/push-diag", method: "POST",
            body: DiagBody(message: message)
        )
    }
}
