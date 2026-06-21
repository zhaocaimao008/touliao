import Foundation

/// 二维码内容：服务端 GET /api/users/me/qrcode 编码的 JSON。
struct QRPayload: Decodable {
    let type: String
    let id: String
    let vxinId: String?
}

@MainActor
final class AddFriendViewModel: ObservableObject {
    @Published var query = ""
    @Published var searching = false
    @Published var results: [SearchUser] = []
    @Published var sentIds: Set<String> = []
    @Published var message: String?
    @Published var searched = false

    private let repo = ContactRepository.shared

    func search() {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty, !searching else { return }
        searching = true
        message = nil
        Task {
            do {
                results = try await repo.search(q)
                searched = true
            } catch {
                message = (error as? LocalizedError)?.errorDescription ?? "搜索失败"
            }
            searching = false
        }
    }

    func sendRequest(_ user: SearchUser) {
        Task {
            do {
                let resp = try await repo.sendFriendRequest(toId: user.id)
                sentIds.insert(user.id)
                message = (resp.autoAccepted == true) ? "已添加为好友" : "好友申请已发送"
            } catch {
                message = (error as? LocalizedError)?.errorDescription ?? "发送失败"
            }
        }
    }

    /// 扫码结果：解析 vxin 二维码并发起好友申请
    func addByQrPayload(_ raw: String, myId: String?) {
        guard let data = raw.data(using: .utf8),
              let payload = try? JSONDecoder().decode(QRPayload.self, from: data),
              payload.type == "vxin-user", !payload.id.isEmpty else {
            message = "无法识别的二维码"
            return
        }
        if payload.id == myId {
            message = "这是你自己的二维码"
            return
        }
        Task {
            do {
                let resp = try await repo.sendFriendRequest(toId: payload.id)
                sentIds.insert(payload.id)
                message = (resp.autoAccepted == true) ? "已添加为好友" : "好友申请已发送"
            } catch {
                message = (error as? LocalizedError)?.errorDescription ?? "添加失败"
            }
        }
    }
}
