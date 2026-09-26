import SwiftUI

@MainActor
final class WalletViewModel: ObservableObject {
    @Published var loading = true
    @Published var balance = 0
    @Published var transactions: [WalletTransaction] = []
    @Published var error: String?

    private let repo = WalletRepository.shared

    func load() async {
        loading = true; error = nil
        do {
            balance = try await repo.balance()
            transactions = (try? await repo.transactions()) ?? []
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "加载钱包失败"
        }
        loading = false
    }
}

struct WalletView: View {
    @StateObject private var vm = WalletViewModel()

    var body: some View {
        List {
            Group {
            Section {
                VStack(spacing: 8) {
                    Text("当前余额（金币）").touliaoText(.caption).foregroundColor(.vxinTextSecondary)
                    Text("\(vm.balance)").touliaoFont(VxinFontSize.displayXl, weight: .bold).foregroundColor(Color(red: 0.98, green: 0.62, blue: 0.23))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
            Section("账单明细") {
                if vm.loading {
                    HStack { Spacer(); ProgressView(); Spacer() }
                } else if vm.transactions.isEmpty {
                    Text("暂无账单").foregroundColor(.vxinTextSecondary)
                } else {
                    ForEach(vm.transactions) { tx in TransactionRow(tx: tx) }
                }
            }
            }.listRowBackground(Color.vxinSurface).listRowSeparatorTint(Color.vxinBorder)
        }
        .navigationTitle("我的钱包")
        .navigationBarTitleDisplayMode(.inline)
        .touliaoPage()
        .task { await vm.load() }
    }
}

private struct TransactionRow: View {
    let tx: WalletTransaction
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(tx.memo.isEmpty ? typeLabel(tx.type) : tx.memo)
                Text(formatTime(tx.createdAt)).touliaoText(.caption).foregroundColor(.vxinTextSecondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text((tx.amount >= 0 ? "+" : "") + "\(tx.amount)")
                    .foregroundColor(tx.amount >= 0 ? .vxinGreen : TouliaoDesign.danger)
                    .fontWeight(.semibold)
                Text("余额 \(tx.balanceAfter)").touliaoText(.caption).foregroundColor(.vxinTextSecondary)
            }
        }
    }
    private func typeLabel(_ t: String) -> String {
        switch t {
        case "red_packet": return "红包"
        case "red_packet_refund": return "红包退款"
        case "recharge": return "充值"
        default: return t.isEmpty ? "交易" : t
        }
    }
    private func formatTime(_ epoch: Double) -> String {
        guard epoch > 0 else { return "" }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm"
        return f.string(from: Date(timeIntervalSince1970: epoch))
    }
}
