import SwiftUI
import PhotosUI

@MainActor
final class MomentComposeViewModel: ObservableObject {
    @Published var content = ""
    @Published var images: [UIImage] = []
    @Published var visibility = "all"
    @Published var publishing = false
    @Published var error: String?

    private let repo = MomentRepository.shared

    func publish(_ onDone: @escaping () -> Void) {
        if content.trimmingCharacters(in: .whitespaces).isEmpty && images.isEmpty {
            error = "请输入内容或选择图片"; return
        }
        guard !publishing else { return }
        publishing = true; error = nil
        Task {
            do {
                var urls: [String] = []
                if !images.isEmpty {
                    let datas = images.compactMap { img -> (Data, String)? in
                        guard let d = img.jpegData(compressionQuality: 0.85) else { return nil }
                        return (d, "moment.jpg")
                    }
                    urls = try await repo.uploadImages(datas)
                }
                _ = try await repo.create(content: content.trimmingCharacters(in: .whitespacesAndNewlines), images: urls, visibility: visibility)
                publishing = false
                onDone()
            } catch {
                publishing = false
                self.error = (error as? LocalizedError)?.errorDescription ?? "发布失败"
            }
        }
    }
}

struct MomentComposeView: View {
    var onPublished: () -> Void
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm = MomentComposeViewModel()
    @State private var pickerItems: [PhotosPickerItem] = []

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("这一刻的想法…", text: $vm.content, axis: .vertical).lineLimit(3...8)
                }
                Section {
                    if !vm.images.isEmpty {
                        ScrollView(.horizontal) {
                            HStack {
                                ForEach(Array(vm.images.enumerated()), id: \.offset) { _, img in
                                    Image(uiImage: img).resizable().scaledToFill()
                                        .frame(width: 72, height: 72).clipShape(RoundedRectangle(cornerRadius: 6))
                                }
                            }
                        }
                    }
                    PhotosPicker(selection: $pickerItems, maxSelectionCount: 9, matching: .images) {
                        Label("添加图片", systemImage: "photo.on.rectangle")
                    }
                }
                Section("谁可以看") {
                    Picker("可见性", selection: $vm.visibility) {
                        Text("公开").tag("all")
                        Text("好友").tag("friends")
                        Text("私密").tag("private")
                    }.pickerStyle(.segmented)
                }
                if let error = vm.error {
                    Text(error).foregroundColor(.vxinError).font(.footnote)
                }
            }
            .navigationTitle("发表").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("发表") { vm.publish { onPublished() } }.disabled(vm.publishing)
                }
            }
            .onChange(of: pickerItems) { items in
                Task {
                    var imgs: [UIImage] = []
                    for item in items {
                        if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) { imgs.append(img) }
                    }
                    vm.images = imgs
                }
            }
        }
    }
}
