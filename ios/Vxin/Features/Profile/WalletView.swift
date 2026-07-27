import SwiftUI

@MainActor
final class WalletViewModel: ObservableObject {
    @Published var loading = true
    @Published var balance = 0
    @Published var transactions: [WalletTransaction] = []
    @Published var error: String?
    @Published var recharging = false
    @Published var rechargeMessage: String?

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

    /// 充值 amount 金币（1-100000）。成功后刷新余额与流水。
    func recharge(amount: Int) async {
        guard amount >= 1 && amount <= 100000 else {
            rechargeMessage = "充值金额需为 1-100000 金币"; return
        }
        recharging = true
        do {
            let res = try await repo.recharge(amount: amount)
            balance = res.balance
            rechargeMessage = "充值成功，到账 \(res.recharged) 金币"
            transactions = (try? await repo.transactions()) ?? transactions
        } catch {
            rechargeMessage = (error as? LocalizedError)?.errorDescription ?? "充值失败"
        }
        recharging = false
    }
}

struct WalletView: View {
    @StateObject private var vm = WalletViewModel()
    @State private var showRecharge = false
    @State private var rechargeInput = ""

    var body: some View {
        List {
            Section {
                VStack(spacing: 8) {
                    Text("当前余额（金币）").font(.caption).foregroundColor(.vxinTextSecondary)
                    Text("\(vm.balance)").font(.system(size: 40, weight: .bold)).foregroundColor(Color(red: 0.98, green: 0.62, blue: 0.23))
                    Button {
                        rechargeInput = ""; showRecharge = true
                    } label: {
                        Text(vm.recharging ? "充值中…" : "充值").fontWeight(.semibold)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(vm.recharging)
                    .padding(.top, 4)
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
        }
        .navigationTitle("我的钱包")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.load() }
        .alert("充值金币", isPresented: $showRecharge) {
            TextField("充值数量（1-100000）", text: $rechargeInput)
                .keyboardType(.numberPad)
            Button("取消", role: .cancel) {}
            Button("确认") {
                let amt = Int(rechargeInput) ?? 0
                Task { await vm.recharge(amount: amt) }
            }
        } message: {
            Text("请输入充值金币数量")
        }
        .alert("提示", isPresented: Binding(
            get: { vm.rechargeMessage != nil },
            set: { if !$0 { vm.rechargeMessage = nil } }
        )) {
            Button("好", role: .cancel) { vm.rechargeMessage = nil }
        } message: {
            Text(vm.rechargeMessage ?? "")
        }
    }
}

private struct TransactionRow: View {
    let tx: WalletTransaction
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(tx.memo.isEmpty ? typeLabel(tx.type) : tx.memo)
                Text(formatTime(tx.createdAt)).font(.caption).foregroundColor(.vxinTextSecondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text((tx.amount >= 0 ? "+" : "") + "\(tx.amount)")
                    .foregroundColor(tx.amount >= 0 ? .vxinGreen : Color(red: 0.98, green: 0.32, blue: 0.32))
                    .fontWeight(.semibold)
                Text("余额 \(tx.balanceAfter)").font(.caption).foregroundColor(.vxinTextSecondary)
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
