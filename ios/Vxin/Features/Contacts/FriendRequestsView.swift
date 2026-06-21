import SwiftUI

struct FriendRequestsView: View {
    @StateObject private var vm = FriendRequestsViewModel()

    var body: some View {
        Group {
            if vm.loading && vm.requests.isEmpty {
                ProgressView()
            } else if vm.requests.isEmpty {
                Text("没有新的好友申请").foregroundColor(.vxinTextSecondary)
            } else {
                List(vm.requests) { req in
                    HStack(spacing: 12) {
                        InitialAvatar(name: req.username.isEmpty ? "?" : req.username, size: 44)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(req.username.isEmpty ? "未命名" : req.username)
                            Text(req.message.isEmpty ? "请求添加你为好友" : req.message)
                                .font(.caption).foregroundColor(.vxinTextSecondary)
                        }
                        Spacer()
                        if vm.handling.contains(req.id) {
                            ProgressView()
                        } else {
                            Button("拒绝") { vm.handle(req, accept: false) }
                                .buttonStyle(.bordered)
                            Button("接受") { vm.handle(req, accept: true) }
                                .buttonStyle(.borderedProminent)
                                .tint(.vxinGreen)
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("新的朋友")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.refresh() }
    }
}
