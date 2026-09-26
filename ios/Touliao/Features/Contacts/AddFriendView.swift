import SwiftUI

struct AddFriendView: View {
    @StateObject private var vm = AddFriendViewModel()
    @EnvironmentObject private var session: SessionStore
    @State private var showScanner = false

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Button { showScanner = true } label: {
                    Label("扫一扫", touliaoIcon: "scan")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).foregroundColor(.vxinOnPrimary).tint(.vxinBrand)

                NavigationLink {
                    MyQRCodeView()
                } label: {
                    Label("我的二维码", touliaoIcon: "qrcode")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .padding(.horizontal)

            HStack {
                TextField("手机号 / 投聊号 / 用户名", text: $vm.query)
                    .textFieldStyle(TouliaoTextFieldStyle())
                    .autocorrectionDisabled(true)
                    .textInputAutocapitalization(.never)
                    .onSubmit { vm.search() }
                Button("搜索") { vm.search() }
                    .disabled(vm.query.isEmpty || vm.searching)
                    .foregroundColor(.vxinBrand)
            }
            .padding(.horizontal)

            if let message = vm.message {
                Text(message).touliaoText(.secondary).foregroundColor(.vxinBrand)
            }

            if vm.searching {
                ProgressView().padding()
            } else if vm.searched && vm.results.isEmpty {
                VxinEmptyState(icon: "search", title: "未找到用户", subtitle: "换个手机号 / 投聊号试试")
            }

            List(vm.results) { user in
                Group {
                HStack(spacing: 12) {
                    InitialAvatar(name: user.username.isEmpty ? "?" : user.username, size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.username.isEmpty ? "未命名" : user.username)
                        if !user.wechatId.isEmpty {
                            Text("投聊号: \(user.wechatId)").touliaoText(.caption).foregroundColor(.vxinTextSecondary)
                        }
                    }
                    Spacer()
                    let sent = vm.sentIds.contains(user.id)
                    Button(sent ? "已发送" : "添加") { vm.sendRequest(user) }
                        .buttonStyle(.borderedProminent).foregroundColor(.vxinOnPrimary)
                        .tint(.vxinBrand)
                        .disabled(sent)
                }
                }.listRowBackground(Color.vxinSurface).listRowSeparatorTint(Color.vxinBorder)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.vxinSurface)

            Spacer()
        }
        .padding(.top, 12)
        .navigationTitle("添加好友")
        .navigationBarTitleDisplayMode(.inline)
        .touliaoPage()
        // 扫码资料卡 Sheet
        .sheet(isPresented: Binding(
            get: { vm.scannedUserId != nil },
            set: { if !$0 { vm.dismissScannedUser() } }
        )) {
            ScannedUserProfileSheet(vm: vm)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .fullScreenCover(isPresented: $showScanner) {
            QRScannerGate(
                onResult: { value in
                    showScanner = false
                    vm.addByQrPayload(value, myId: session.currentUser?.id)
                },
                onCancel: { showScanner = false }
            )
            .ignoresSafeArea()
        }
    }
}

// MARK: - 扫码资料卡

private struct ScannedUserProfileSheet: View {
    @ObservedObject var vm: AddFriendViewModel

    var body: some View {
        VStack(spacing: 0) {
            if vm.scannedUserLoading {
                Spacer()
                ProgressView().tint(.vxinBrand)
                Spacer()
            } else if let detail = vm.scannedUserDetail {
                profileContent(detail)
            } else {
                Spacer()
                Text("加载失败").foregroundColor(.vxinTextSecondary)
                Spacer()
                Button("关闭") { vm.dismissScannedUser() }
                    .buttonStyle(.bordered)
                    .padding(.bottom, 32)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 24)
    }

    @ViewBuilder
    private func profileContent(_ detail: UserDetail) -> some View {
        let alreadySent = vm.sentIds.contains(detail.id)

        VStack(spacing: 12) {
            InitialAvatar(name: detail.username.isEmpty ? "?" : detail.username, size: 72)

            Text(detail.username.isEmpty ? "未命名" : detail.username)
                .touliaoText(.headline).fontWeight(.semibold)

            if !detail.wechatId.isEmpty {
                Text("投聊号: \(detail.wechatId)")
                    .touliaoText(.caption).foregroundColor(.vxinTextSecondary)
            }

            if !detail.bio.isEmpty {
                Text(detail.bio)
                    .touliaoText(.secondary).foregroundColor(.vxinTextSecondary)
                    .multilineTextAlignment(.center)
            }

            Divider().padding(.vertical, 8)

            if detail.isFriend {
                Text("你们已经是好友了").foregroundColor(.vxinTextSecondary)
                Spacer().frame(height: 8)
                Button("关闭") { vm.dismissScannedUser() }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
            } else if detail.hasPendingRequest || alreadySent {
                Text("好友申请已发送，等待对方确认")
                    .touliaoText(.secondary).foregroundColor(.vxinTextSecondary)
                Spacer().frame(height: 8)
                Button("关闭") { vm.dismissScannedUser() }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
            } else {
                Button("申请添加好友") { vm.sendRequestFromScanned() }
                    .buttonStyle(.borderedProminent).foregroundColor(.vxinOnPrimary)
                    .tint(.vxinBrand)
                    .frame(maxWidth: .infinity)
                Button("取消") { vm.dismissScannedUser() }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
            }
        }
        Spacer()
    }
}
