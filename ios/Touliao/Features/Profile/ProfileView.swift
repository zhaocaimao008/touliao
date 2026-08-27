import SwiftUI
import UIKit
import PhotosUI
import Kingfisher

// MARK: - Design Tokens
// 语义色（UIColor.system*）自动跟随 Light/Dark，替代母版硬编码 RGB。

private enum Tok {
    static let xs: CGFloat = 4;  static let s: CGFloat = 8
    static let m: CGFloat = 12;  static let l: CGFloat = 16
    static let xl: CGFloat = 20; static let xxl: CGFloat = 24
    static let cardRadius: CGFloat = 18
    static let avatarSize: CGFloat = 66
    static let iconSize: CGFloat = 22
    static let rowHeight: CGFloat = 57
    static let green    = Color.vxinBrand
    static let greenBg  = Color.vxinBrand.opacity(0.12)
    static let primary  = Color(UIColor.label)
    static let secondary = Color(UIColor.secondaryLabel)
    static let bg       = Color(UIColor.systemGroupedBackground)
    static let cardBg   = Color(UIColor.secondarySystemGroupedBackground)
    static let divider  = Color(UIColor.separator)
    static let red      = Color(UIColor.systemRed)
    static let iconGray = Color(UIColor.label)
}

// MARK: - Reusable components

/// Section card wrapper (rounded card, very light border)
private struct VxCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(spacing: 0) { content }
            .background(Tok.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: Tok.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Tok.cardRadius, style: .continuous)
                    .stroke(Tok.divider, lineWidth: 0.5)
            )
    }
}

/// Section header label above a card
private struct SectionHeader: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 14, weight: .medium))
            .foregroundColor(Tok.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Tok.xl)
            .padding(.top, Tok.xl)
            .padding(.bottom, Tok.s)
    }
}

/// Standard settings row: icon | title | [trailing] | chevron
private struct SettingsRow: View {
    let icon: String
    let title: String
    var trailing: String? = nil
    var iconColor: Color = Tok.iconGray
    var body: some View {
        HStack(spacing: Tok.m) {
            Image(systemName: icon)
                .font(.system(size: Tok.iconSize - 2, weight: .light))
                .foregroundColor(iconColor)
                .frame(width: Tok.xxl, alignment: .center)
            Text(title)
                .font(.system(size: 16.5))
                .foregroundColor(Tok.primary)
            Spacer()
            if let t = trailing {
                Text(t)
                    .font(.system(size: 15))
                    .foregroundColor(Tok.secondary)
                    .lineLimit(1)
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Tok.secondary.opacity(0.6))
        }
        .padding(.horizontal, Tok.l)
        .frame(minHeight: Tok.rowHeight)
        .background(Tok.cardBg)
        .contentShape(Rectangle())
    }
}

private struct RowDivider: View {
    var body: some View {
        Divider()
            .background(Tok.divider)
            .padding(.leading, Tok.l + Tok.xxl + Tok.m)
    }
}

// MARK: - ProfileView (我的)

struct ProfileView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var showEdit = false
    @State private var showLogout = false
    @State private var showSwitchAccount = false
    @State private var versionTaps = 0
    @State private var showBuild = false

    private var user: User? { session.currentUser }

    private func maskedPhone(_ phone: String) -> String {
        guard phone.count >= 7 else { return phone.isEmpty ? "未绑定" : phone }
        return "\(phone.prefix(3))****\(phone.suffix(4))"
    }

    static var shortVer: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
    }
    static var buildNum: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // ── 1. Profile header card ──────────────────────────
                profileHeader
                    .padding(.horizontal, Tok.l)
                    .padding(.top, Tok.xxl)
                    .padding(.bottom, Tok.m)

                // ── 2. 账户与服务 ───────────────────────────────────
                SectionHeader(text: "账户与服务")
                    .padding(.horizontal, 0)
                VxCard {
                    NavigationLink(destination: ChangePhoneView(
                        currentPhone: user?.phone ?? "",
                        onChanged: { p in
                            if var u = session.currentUser { u.phone = p; session.updateCurrentUser(u) }
                        })) {
                        SettingsRow(icon: "phone",
                                    title: "手机号",
                                    trailing: maskedPhone(user?.phone ?? ""))
                    }
                    .buttonStyle(.plain)
                    RowDivider()
                    NavigationLink(destination: WalletView()) {
                        SettingsRow(icon: "creditcard", title: "我的钱包")
                    }
                    .buttonStyle(.plain)
                    RowDivider()
                    NavigationLink(destination: FavoritesView()) {
                        SettingsRow(icon: "star", title: "收藏")
                    }
                    .buttonStyle(.plain)
                    RowDivider()
                    NavigationLink(destination: CallHistoryView()) {
                        SettingsRow(icon: "phone.arrow.up.right", title: "通话记录")
                    }
                    .buttonStyle(.plain)
                    RowDivider()
                    NavigationLink(destination: SessionsView()) {
                        SettingsRow(icon: "laptopcomputer.and.iphone", title: "登录设备管理")
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, Tok.l)
                .padding(.bottom, Tok.m)

                // ── 3. 设置（收拢进独立设置页）──────────────────────
                VxCard {
                    NavigationLink(destination: SettingsHomeView()) {
                        SettingsRow(icon: "gearshape", title: "设置")
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, Tok.l)
                .padding(.top, Tok.m)
                .padding(.bottom, Tok.m)

                // ── 4. 其他 ────────────────────────────────────────
                SectionHeader(text: "其他")
                VxCard {
                    NavigationLink(destination: InviteFriendView()) {
                        SettingsRow(icon: "person.badge.plus", title: "邀请好友")
                    }
                    .buttonStyle(.plain)
                    RowDivider()
                    Button { showSwitchAccount = true } label: {
                        SettingsRow(
                            icon: "person.2",
                            title: "切换账号",
                            trailing: "\(user?.username.isEmpty == false ? user!.username : "当前") · 当前"
                        )
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, Tok.l)
                .padding(.bottom, Tok.m)

                // ── 5. 退出登录 ────────────────────────────────────
                VxCard {
                    Button {
                        showLogout = true
                    } label: {
                        Text("退出登录")
                            .font(.system(size: 16.5))
                            .foregroundColor(Tok.red)
                            .frame(maxWidth: .infinity, minHeight: 54)
                    }
                }
                .padding(.horizontal, Tok.l)
                .padding(.bottom, Tok.m)

                // ── 6. 版本号 ──────────────────────────────────────
                VStack(spacing: 2) {
                    Text(showBuild ? "投聊 \(Self.shortVer) (\(Self.buildNum))" : "投聊 \(Self.shortVer)")
                        .font(.system(size: 13))
                        .foregroundColor(Tok.secondary)
                        .onTapGesture {
                            versionTaps += 1
                            if versionTaps >= 5 { showBuild = true }
                        }
                }
                .frame(maxWidth: .infinity)
                .padding(.bottom, Tok.xxl)
            }
        }
        .background(Tok.bg.ignoresSafeArea())
        .navigationBarHidden(true)
        .sheet(isPresented: $showEdit) {
            NavigationStack { ProfileEditView() }
        }
        .sheet(isPresented: $showSwitchAccount) {
            NavigationStack { AccountManagementView() }
        }
        .alert("退出登录", isPresented: $showLogout) {
            Button("退出", role: .destructive) { Task { await session.logout() } }
            Button("取消", role: .cancel) {}
        } message: { Text("确认退出当前账号？") }
    }

    // MARK: Profile header card

    private var profileHeader: some View {
        Button { showEdit = true } label: {
            HStack(spacing: Tok.m) {
                avatarView
                VStack(alignment: .leading, spacing: 4) {
                    Text(user?.username.isEmpty == false ? user!.username : "未设置昵称")
                        .font(.system(size: 21, weight: .semibold))
                        .foregroundColor(Tok.primary)
                        .lineLimit(1)
                    if let id = user?.wechatId, !id.isEmpty {
                        Text("投聊号：\(id)")
                            .font(.system(size: 14))
                            .foregroundColor(Tok.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer()
                // QR code button — independent tap
                NavigationLink(destination: MyQRCodeView()) {
                    Image(systemName: "qrcode")
                        .font(.system(size: 21, weight: .light))
                        .foregroundColor(Tok.green)
                }
                .buttonStyle(.plain)
                .simultaneousGesture(TapGesture())   // prevent card tap from firing
                .accessibilityIdentifier("profile-my-qr")
                .padding(.trailing, 4)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Tok.secondary.opacity(0.6))
            }
            .padding(Tok.l)
            .background(Tok.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: Tok.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Tok.cardRadius, style: .continuous)
                    .stroke(Tok.divider, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private var avatarView: some View {
        if let avatar = user?.avatar, !avatar.isEmpty,
           let src = MediaUrlResolver.kfSource(raw: avatar) {
            KFImage(source: src)
                .resizable().scaledToFill()
                .frame(width: Tok.avatarSize, height: Tok.avatarSize)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        } else {
            InitialAvatar(name: user?.username ?? "?", size: Tok.avatarSize)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }
}
