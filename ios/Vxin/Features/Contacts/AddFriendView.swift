import SwiftUI

struct AddFriendView: View {
    @StateObject private var vm = AddFriendViewModel()
    @EnvironmentObject private var session: SessionStore
    @State private var showScanner = false

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Button { showScanner = true } label: {
                    Label("扫一扫", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).tint(.vxinGreen)

                NavigationLink {
                    MyQRCodeView()
                } label: {
                    Label("我的二维码", systemImage: "qrcode")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .padding(.horizontal)

            HStack {
                TextField("手机号 / v信号 / 用户名", text: $vm.query)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled(true)
                    .textInputAutocapitalization(.never)
                    .onSubmit { vm.search() }
                Button("搜索") { vm.search() }
                    .disabled(vm.query.isEmpty || vm.searching)
                    .foregroundColor(.vxinGreen)
            }
            .padding(.horizontal)

            if let message = vm.message {
                Text(message).font(.footnote).foregroundColor(.vxinGreen)
            }

            if vm.searching {
                ProgressView().padding()
            } else if vm.searched && vm.results.isEmpty {
                VxinEmptyState(systemImage: "magnifyingglass", title: "未找到用户", subtitle: "换个手机号 / v信号试试")
            }

            List(vm.results) { user in
                HStack(spacing: 12) {
                    InitialAvatar(name: user.username.isEmpty ? "?" : user.username, size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.username.isEmpty ? "未命名" : user.username)
                        if !user.wechatId.isEmpty {
                            Text("v信号: \(user.wechatId)").font(.caption).foregroundColor(.vxinTextSecondary)
                        }
                    }
                    Spacer()
                    let sent = vm.sentIds.contains(user.id)
                    Button(sent ? "已发送" : "添加") { vm.sendRequest(user) }
                        .buttonStyle(.borderedProminent)
                        .tint(.vxinGreen)
                        .disabled(sent)
                }
            }
            .listStyle(.plain)

            Spacer()
        }
        .padding(.top, 12)
        .navigationTitle("添加好友")
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(isPresented: $showScanner) {
            QRScannerView(
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
