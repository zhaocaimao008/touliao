import Foundation

struct WalletBalance: Decodable { let balance: Int }

/// 钱包流水（对齐后端 wallet_transactions）。amount 正=入账/负=出账。
struct WalletTransaction: Decodable, Identifiable {
    let id: String
    let amount: Int
    let balanceAfter: Int
    let type: String
    let memo: String
    let createdAt: Double

    enum CodingKeys: String, CodingKey {
        case id, amount, type, memo
        case balanceAfter = "balance_after"
        case createdAt = "created_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        amount = (try? c.decode(Int.self, forKey: .amount)) ?? 0
        balanceAfter = (try? c.decode(Int.self, forKey: .balanceAfter)) ?? 0
        type = (try? c.decode(String.self, forKey: .type)) ?? ""
        memo = (try? c.decode(String.self, forKey: .memo)) ?? ""
        createdAt = (try? c.decode(Double.self, forKey: .createdAt)) ?? 0
    }
}

/// 好友转账请求体（POST /api/wallet/transfer）。字段名对齐后端 snake_case。
struct TransferBody: Encodable {
    let to_user_id: String
    let amount: Int
    let note: String
}

/// 转账响应 —— { success, balance, message? }。message 为新产生的 transfer 类型消息（可选）。
struct TransferResponse: Decodable {
    let success: Bool
    let balance: Int
    let message: Message?
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        success = (try? c.decode(Bool.self, forKey: .success)) ?? false
        balance = (try? c.decode(Int.self, forKey: .balance)) ?? 0
        message = try? c.decode(Message.self, forKey: .message)
    }
    enum CodingKeys: String, CodingKey { case success, balance, message }
}

/// transfer 类型消息的 content（JSON 字符串）解析结果。与 Web/Android 对齐：amount / note / toUserId / toUsername。
struct TransferContent: Decodable {
    let amount: Int
    let note: String
    let toUserId: String
    let toUsername: String
    enum CodingKeys: String, CodingKey { case amount, note, toUserId, toUsername }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        amount = (try? c.decode(Int.self, forKey: .amount)) ?? 0
        note = (try? c.decode(String.self, forKey: .note)) ?? ""
        toUserId = (try? c.decode(String.self, forKey: .toUserId)) ?? ""
        toUsername = (try? c.decode(String.self, forKey: .toUsername)) ?? ""
    }
}

/// 钱包（余额 / 流水 / 转账；充值已下线）。
final class WalletRepository {
    static let shared = WalletRepository()
    private init() {}
    private let api = APIClient.shared

    func balance() async throws -> Int {
        let res: WalletBalance = try await api.send("api/wallet")
        return res.balance
    }

    func transactions(limit: Int = 50, offset: Int = 0) async throws -> [WalletTransaction] {
        try await api.send("api/wallet/transactions?limit=\(limit)&offset=\(offset)")
    }

    /// 好友转账 amount 金币（1-20000）到 toUserId，note 为备注（可选，≤50 字）。
    /// 成功后返回最新余额及 transfer 类型消息（转账即到账）。
    func transfer(toUserId: String, amount: Int, note: String = "") async throws -> TransferResponse {
        try await api.send(
            "api/wallet/transfer", method: "POST",
            body: TransferBody(to_user_id: toUserId, amount: amount, note: note)
        )
    }
}
