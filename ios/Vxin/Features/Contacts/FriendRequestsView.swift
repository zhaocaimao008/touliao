import SwiftUI

struct FriendRequestsView: View {
    @StateObject private var vm = FriendRequestsViewModel()
    @State private var tab = 0

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $tab) {
                Text("收到").tag(0)
                Text("已发送").tag(1)
            }
            .pickerStyle(.segmented)
            .padding()

            if tab == 0 {
                receivedList
            } else {
                sentList
            }
        }
        .navigationTitle("新的朋友")
        .navigationBarTitleDisplayMode(.inline)
        .toast($vm.error)
        .task { await vm.refresh() }
    }

    @ViewBuilder private var receivedList: some View {
        if vm.loading && vm.requests.isEmpty {
            ProgressView(); Spacer()
        } else if vm.requests.isEmpty {
            Text("没有新的好友申请").foregroundColor(.vxinTextSecondary); Spacer()
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
                        Button("拒绝") { vm.handle(req, accept: false) }.buttonStyle(.bordered)
                        Button("接受") { vm.handle(req, accept: true) }.buttonStyle(.borderedProminent).tint(.vxinGreen)
                    }
                }
            }
            .listStyle(.plain)
        }
    }

    @ViewBuilder private var sentList: some View {
        if vm.sent.isEmpty {
            Text("没有已发送的申请").foregroundColor(.vxinTextSecondary); Spacer()
        } else {
            List(vm.sent) { req in
                HStack(spacing: 12) {
                    InitialAvatar(name: req.username.isEmpty ? "?" : req.username, size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(req.username.isEmpty ? "未命名" : req.username)
                        Text(req.message.isEmpty ? "请求添加对方为好友" : req.message)
                            .font(.caption).foregroundColor(.vxinTextSecondary)
                    }
                    Spacer()
                    Text(req.status == "accepted" ? "已同意" : (req.status == "rejected" ? "已拒绝" : "等待验证"))
                        .font(.caption)
                        .foregroundColor(req.status == "accepted" ? .vxinGreen : .vxinTextSecondary)
                }
            }
            .listStyle(.plain)
        }
    }
}
