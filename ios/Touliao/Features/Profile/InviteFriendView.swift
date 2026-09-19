import SwiftUI

/// 邀请好友页（主页只显示 ">", 进入此页再展示邀请码和分享）
struct InviteFriendView: View {
    @State private var invite: InviteInfo?
    @State private var copied = false
    private let repo = ProfileRepository.shared

    private enum Tok {
        static let green     = Color.vxinBrand
        static let secondary = Color.vxinTextSecondary
    }

    var body: some View {
        Form {
            Group {
            if let inv = invite {
                Section("我的邀请码") {
                    HStack {
                        Text(inv.code.isEmpty ? "—" : inv.code)
                            .touliaoText(.title, weight: .semibold, design: .monospaced)
                            .foregroundColor(Tok.green)
                        Spacer()
                        Button(copied ? "已复制" : "复制") {
                            guard !inv.code.isEmpty else { return }
                            UIPasteboard.general.string = inv.code
                            copied = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { copied = false }
                        }
                        .buttonStyle(.borderedProminent).foregroundColor(.vxinOnPrimary)
                        .tint(Tok.green)
                        .disabled(inv.code.isEmpty)
                    }
                    .padding(.vertical, 4)
                }

                Section {
                    HStack {
                        Text("已成功邀请")
                        Spacer()
                        Text("\(inv.invitedCount) 人")
                            .foregroundColor(Tok.secondary)
                    }
                }

                if !inv.invitees.isEmpty {
                    Section("邀请的好友") {
                        ForEach(inv.invitees.prefix(20)) { u in
                            HStack(spacing: 10) {
                                InitialAvatar(name: u.username.isEmpty ? "?" : u.username, size: 32)
                                Text(u.username.isEmpty ? "未命名" : u.username)
                                    .touliaoText(.secondary)
                            }
                        }
                    }
                }
            } else {
                Section {
                    HStack { Spacer(); ProgressView(); Spacer() }
                }
            }
            }.listRowBackground(Color.vxinSurface).listRowSeparatorTint(Color.vxinBorder)
        }
        .navigationTitle("邀请好友")
        .navigationBarTitleDisplayMode(.inline)
        .touliaoPage()
        .task {
            invite = try? await repo.myInvite()
        }
    }
}
