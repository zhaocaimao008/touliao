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
        .touliaoPage()
        .toast($vm.error)
        .task { await vm.refresh() }
    }

    @ViewBuilder private var receivedList: some View {
        if vm.loading && vm.requests.isEmpty {
            ProgressView(); Spacer()
        } else if vm.requests.isEmpty {
            VxinEmptyState(icon: "addFriend", title: "没有新的好友申请"); Spacer()
        } else {
            List(vm.requests) { req in
                Group {
                HStack(spacing: 12) {
                    InitialAvatar(name: req.username.isEmpty ? "?" : req.username, size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(req.username.isEmpty ? "未命名" : req.username)
                                .lineLimit(1)
                            Spacer()
                            // 申请时间（F5 补齐，对齐 Web/Android 名字行右侧展示）
                            Text(formatChatTime(req.createdAt))
                                .touliaoText(.caption).foregroundColor(.vxinTextSecondary)
                        }
                        Text(req.message.isEmpty ? "请求添加你为好友" : req.message)
                            .touliaoText(.caption).foregroundColor(.vxinTextSecondary)
                    }
                    Spacer()
                    if vm.handling.contains(req.id) {
                        ProgressView()
                    } else {
                        Button("拒绝") { vm.handle(req, accept: false) }.buttonStyle(.bordered)
                        Button("接受") { vm.handle(req, accept: true) }.buttonStyle(.borderedProminent).foregroundColor(.vxinOnPrimary).tint(.vxinGreen)
                    }
                }
                }.listRowBackground(Color.vxinSurface).listRowSeparatorTint(Color.vxinBorder)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.vxinSurface)
        }
    }

    @ViewBuilder private var sentList: some View {
        if vm.sent.isEmpty {
            VxinEmptyState(icon: "send", title: "没有已发送的申请"); Spacer()
        } else {
            List(vm.sent) { req in
                Group {
                HStack(spacing: 12) {
                    InitialAvatar(name: req.username.isEmpty ? "?" : req.username, size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(req.username.isEmpty ? "未命名" : req.username)
                                .lineLimit(1)
                            Spacer()
                            // 申请时间（F5 补齐，对齐 Web/Android 名字行右侧展示）
                            Text(formatChatTime(req.createdAt))
                                .touliaoText(.caption).foregroundColor(.vxinTextSecondary)
                        }
                        Text(req.message.isEmpty ? "请求添加对方为好友" : req.message)
                            .touliaoText(.caption).foregroundColor(.vxinTextSecondary)
                    }
                    Spacer()
                    Text(req.status == "accepted" ? "已同意" : (req.status == "rejected" ? "已拒绝" : "等待验证"))
                        .touliaoText(.caption)
                        .foregroundColor(req.status == "accepted" ? .vxinGreen : .vxinTextSecondary)
                }
                }.listRowBackground(Color.vxinSurface).listRowSeparatorTint(Color.vxinBorder)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.vxinSurface)
        }
    }
}
