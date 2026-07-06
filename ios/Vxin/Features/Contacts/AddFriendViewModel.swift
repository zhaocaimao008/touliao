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
                if resp.autoAccepted == true { Haptics.notify(.success) } else { Haptics.impact(.light) }
                message = (resp.autoAccepted == true) ? "已添加为好友" : "好友申请已发送"
            } catch {
                Haptics.notify(.error)
                message = (error as? LocalizedError)?.errorDescription ?? "发送失败"
            }
        }
    }

    /// 扫码结果：vxin 用户码 → 加好友；群邀请链接(/join/TOKEN) → 进群
    func addByQrPayload(_ raw: String, myId: String?) {
        if let r = raw.range(of: "/join/") {
            let rest = String(raw[r.upperBound...])
            let token = rest.split(whereSeparator: { $0 == "?" || $0 == "/" }).first.map(String.init) ?? ""
            if !token.isEmpty { joinGroup(token); return }
        }
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
                if resp.autoAccepted == true { Haptics.notify(.success) } else { Haptics.impact(.light) }
                message = (resp.autoAccepted == true) ? "已添加为好友" : "好友申请已发送"
            } catch {
                Haptics.notify(.error)
                message = (error as? LocalizedError)?.errorDescription ?? "添加失败"
            }
        }
    }

    private func joinGroup(_ token: String) {
        Task {
            do {
                let r = try await GroupRepository.shared.join(token: token)
                if !r.alreadyMember { Haptics.notify(.success) }   // 成功进群的满足感
                message = r.alreadyMember ? "你已在该群" : "已加入群聊"
            } catch {
                Haptics.notify(.error)
                message = (error as? LocalizedError)?.errorDescription ?? "进群失败"
            }
        }
    }
}
