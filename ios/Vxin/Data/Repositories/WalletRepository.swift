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

/// 充值请求体（amount 单位：金币，1-100000）。
struct RechargeBody: Encodable { let amount: Int }

/// 充值响应 —— { success, balance, recharged }。
struct RechargeResponse: Decodable {
    let success: Bool
    let balance: Int
    let recharged: Int
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        success = (try? c.decode(Bool.self, forKey: .success)) ?? false
        balance = (try? c.decode(Int.self, forKey: .balance)) ?? 0
        recharged = (try? c.decode(Int.self, forKey: .recharged)) ?? 0
    }
    enum CodingKeys: String, CodingKey { case success, balance, recharged }
}

/// 钱包（余额 / 流水 / 充值）。
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

    /// 充值 amount 金币（1-100000），返回最新余额与入账数。
    func recharge(amount: Int) async throws -> RechargeResponse {
        try await api.send("api/wallet/recharge", method: "POST", body: RechargeBody(amount: amount))
    }
}
