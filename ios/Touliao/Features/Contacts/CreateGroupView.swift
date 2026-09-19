import SwiftUI

struct CreateGroupView: View {
    var onCreated: (Conversation) -> Void

    @StateObject private var vm = CreateGroupViewModel()

    var body: some View {
        VStack(spacing: 0) {
            TextField("群名称（留空自动生成）", text: $vm.name)
                .textFieldStyle(TouliaoTextFieldStyle())
                .padding()

            if vm.loading {
                Spacer(); ProgressView(); Spacer()
            } else if vm.contacts.isEmpty {
                Spacer(); Text("还没有联系人").foregroundColor(.vxinTextSecondary); Spacer()
            } else {
                List(vm.contacts) { contact in
                    Group {
                    Button { vm.toggle(contact.id) } label: {
                        HStack(spacing: 12) {
                            TouliaoIcon(vm.selected.contains(contact.id) ? "selected" : "unselected")
                                .foregroundColor(vm.selected.contains(contact.id) ? .vxinGreen : .vxinTextSecondary)
                            InitialAvatar(name: contact.displayName.isEmpty ? "?" : contact.displayName, size: 40)
                            Text(contact.displayName.isEmpty ? "未命名" : contact.displayName).foregroundColor(.vxinText)
                            Spacer()
                        }
                    }
                    }.listRowBackground(Color.vxinSurface).listRowSeparatorTint(Color.vxinBorder)
                }
                .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.vxinSurface)
            }

            if let error = vm.error {
                Text(error).foregroundColor(.vxinError).touliaoFont(14).padding(8)
            }
        }
        .navigationTitle("发起群聊")
        .navigationBarTitleDisplayMode(.inline)
        .touliaoPage()
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(vm.selected.isEmpty ? "创建" : "创建(\(vm.selected.count))") {
                    Task { if let conv = await vm.create() { onCreated(conv) } }
                }
                .disabled(!vm.canCreate)
            }
        }
        .task { await vm.load() }
    }
}
