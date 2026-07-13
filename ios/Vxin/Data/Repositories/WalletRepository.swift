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

/// 钱包（余额 / 流水）。充值端点后端暂关闭（503），不接入。
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
}
