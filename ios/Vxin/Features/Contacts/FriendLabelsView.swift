import SwiftUI

@MainActor
final class FriendLabelsViewModel: ObservableObject {
    @Published var loading = true
    @Published var labels: [FriendLabel] = []
    @Published var contacts: [Contact] = []
    @Published var error: String?

    private let repo = FriendLabelRepository.shared
    private let contactRepo = ContactRepository.shared

    func load() async {
        loading = true; error = nil
        do {
            labels = try await repo.list()
            contacts = (try? await contactRepo.contacts()) ?? []
        } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "加载失败" }
        loading = false
    }

    func create(_ name: String) {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        Task {
            do { _ = try await repo.create(name: n); await load() }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "创建失败" }
        }
    }

    func delete(_ id: String) {
        Task {
            do { try await repo.delete(id); labels.removeAll { $0.id == id } }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "删除失败" }
        }
    }

    func toggleMember(labelId: String, friendId: String, add: Bool) {
        Task {
            do {
                if add { _ = try await repo.addMember(labelId, friendId: friendId) }
                else { try await repo.removeMember(labelId, friendId: friendId) }
                await load()
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "操作失败" }
        }
    }
}

struct FriendLabelsView: View {
    @StateObject private var vm = FriendLabelsViewModel()
    @State private var showCreate = false
    @State private var newName = ""
    @State private var editLabel: FriendLabel?

    var body: some View {
        List {
            if vm.loading {
                HStack { Spacer(); ProgressView(); Spacer() }
            } else if vm.labels.isEmpty {
                Text("还没有标签，点右上 + 新建").foregroundColor(.vxinTextSecondary)
            } else {
                ForEach(vm.labels) { label in
                    Button { editLabel = label } label: {
                        HStack {
                            Circle().fill(Color(hexOrGreen: label.color)).frame(width: 12, height: 12)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(label.name.isEmpty ? "未命名标签" : label.name).foregroundColor(.primary)
                                Text("\(label.members.count) 位好友").font(.caption).foregroundColor(.vxinTextSecondary)
                            }
                            Spacer()
                        }
                    }
                    .swipeActions {
                        Button("删除", role: .destructive) { vm.delete(label.id) }
                    }
                }
            }
        }
        .navigationTitle("好友标签")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { showCreate = true } label: { Image(systemName: "plus") }
            }
        }
        .task { await vm.load() }
        .alert("新建标签", isPresented: $showCreate) {
            TextField("标签名（≤20字）", text: $newName)
            Button("取消", role: .cancel) { newName = "" }
            Button("创建") { vm.create(newName); newName = "" }
        }
        .sheet(item: $editLabel) { label in
            LabelMembersSheet(label: label, contacts: vm.contacts) { friendId, add in
                vm.toggleMember(labelId: label.id, friendId: friendId, add: add)
            }
        }
    }
}

private struct LabelMembersSheet: View {
    let label: FriendLabel
    let contacts: [Contact]
    var onToggle: (String, Bool) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var memberIds: Set<String>

    init(label: FriendLabel, contacts: [Contact], onToggle: @escaping (String, Bool) -> Void) {
        self.label = label; self.contacts = contacts; self.onToggle = onToggle
        _memberIds = State(initialValue: Set(label.members.map { $0.id }))
    }

    var body: some View {
        NavigationStack {
            List(contacts) { c in
                Button {
                    let add = !memberIds.contains(c.id)
                    if add { memberIds.insert(c.id) } else { memberIds.remove(c.id) }
                    onToggle(c.id, add)
                } label: {
                    HStack {
                        Text(c.displayName.isEmpty ? "未命名" : c.displayName).foregroundColor(.primary)
                        Spacer()
                        if memberIds.contains(c.id) { Image(systemName: "checkmark").foregroundColor(.vxinGreen) }
                    }
                }
            }
            .navigationTitle("编辑「\(label.name)」成员")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
    }
}

private extension Color {
    init(hexOrGreen hex: String) {
        let s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        if s.count == 6, let v = UInt64(s, radix: 16) {
            self = Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
        } else { self = .vxinGreen }
    }
}
