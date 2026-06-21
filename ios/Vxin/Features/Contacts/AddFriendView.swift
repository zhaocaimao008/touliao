import SwiftUI

struct AddFriendView: View {
    @StateObject private var vm = AddFriendViewModel()

    var body: some View {
        VStack(spacing: 12) {
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
                Text("未找到用户").foregroundColor(.vxinTextSecondary).padding()
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
    }
}
