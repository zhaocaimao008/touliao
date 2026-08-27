import SwiftUI

struct CreateGroupView: View {
    var onCreated: (Conversation) -> Void

    @StateObject private var vm = CreateGroupViewModel()

    var body: some View {
        VStack(spacing: 0) {
            TextField("群名称（留空自动生成）", text: $vm.name)
                .textFieldStyle(.roundedBorder)
                .padding()

            if vm.loading {
                Spacer(); ProgressView(); Spacer()
            } else if vm.contacts.isEmpty {
                Spacer(); Text("还没有联系人").foregroundColor(.vxinTextSecondary); Spacer()
            } else {
                List(vm.contacts) { contact in
                    Button { vm.toggle(contact.id) } label: {
                        HStack(spacing: 12) {
                            Image(systemName: vm.selected.contains(contact.id) ? "checkmark.circle.fill" : "circle")
                                .foregroundColor(vm.selected.contains(contact.id) ? .vxinGreen : .vxinTextSecondary)
                            InitialAvatar(name: contact.displayName.isEmpty ? "?" : contact.displayName, size: 40)
                            Text(contact.displayName.isEmpty ? "未命名" : contact.displayName).foregroundColor(.primary)
                            Spacer()
                        }
                    }
                }
                .listStyle(.plain)
            }

            if let error = vm.error {
                Text(error).foregroundColor(.vxinError).font(.footnote).padding(8)
            }
        }
        .navigationTitle("发起群聊")
        .navigationBarTitleDisplayMode(.inline)
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
