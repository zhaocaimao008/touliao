import SwiftUI

struct InviteMembersView: View {
    let conversationId: String
    var onDone: () -> Void

    @StateObject private var vm: InviteMembersViewModel

    init(conversationId: String, onDone: @escaping () -> Void) {
        self.conversationId = conversationId
        self.onDone = onDone
        _vm = StateObject(wrappedValue: InviteMembersViewModel(conversationId: conversationId))
    }

    var body: some View {
        Group {
            if vm.loading {
                ProgressView()
            } else if vm.candidates.isEmpty {
                Text("没有可邀请的联系人").foregroundColor(.vxinTextSecondary)
            } else {
                List(vm.candidates) { contact in
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
        }
        .navigationTitle("邀请成员")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(vm.selected.isEmpty ? "邀请" : "邀请(\(vm.selected.count))") { vm.invite() }
                    .disabled(vm.selected.isEmpty || vm.inviting)
            }
        }
        .task { await vm.load() }
        .onChange(of: vm.done) { done in if done { onDone() } }
    }
}
