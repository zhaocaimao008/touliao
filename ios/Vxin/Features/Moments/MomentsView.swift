import SwiftUI
import Kingfisher

@MainActor
final class MomentsViewModel: ObservableObject {
    @Published var moments: [Moment] = []
    @Published var loading = true
    @Published var reachedEnd = false
    @Published var error: String?

    private let repo = MomentRepository.shared
    private let page = 20
    var myId: String

    init(myId: String) { self.myId = myId }

    func refresh() async {
        loading = true; error = nil
        do {
            moments = try await repo.timeline(limit: page, offset: 0)
            reachedEnd = moments.count < page
        } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "加载失败" }
        loading = false
    }

    func loadMore() {
        guard !reachedEnd, !loading else { return }
        Task {
            if let more = try? await repo.timeline(limit: page, offset: moments.count) {
                moments.append(contentsOf: more)
                reachedEnd = more.count < page
            }
        }
    }

    func toggleLike(_ m: Moment) {
        Task {
            if let resp = try? await repo.like(m.id), let idx = moments.firstIndex(where: { $0.id == m.id }) {
                moments[idx].liked = resp.liked
                moments[idx].likeCount = resp.likeCount
                // 维护点赞名单（简化：本地增删自己）
                if resp.liked {
                    if !moments[idx].likes.contains(where: { $0.userId == myId }) {
                        moments[idx].likes.append(MomentLike(userId: myId, username: "我"))
                    }
                } else {
                    moments[idx].likes.removeAll { $0.userId == myId }
                }
            }
        }
    }

    func comment(_ m: Moment, text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        Task {
            do {
                let c = try await repo.comment(m.id, content: t)
                if let idx = moments.firstIndex(where: { $0.id == m.id }) {
                    moments[idx].comments.append(c)
                    moments[idx].commentCount += 1
                }
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "评论失败" }
        }
    }

    func delete(_ m: Moment) {
        Task {
            do { try await repo.delete(m.id); moments.removeAll { $0.id == m.id } }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "删除失败" }
        }
    }
}

struct MomentsView: View {
    @EnvironmentObject private var session: SessionStore
    @StateObject private var vm: MomentsViewModel
    @State private var commentingId: String?
    @State private var commentText = ""
    @State private var deleteTarget: Moment?

    init() {
        // myId 在 onAppear 用 session 不便于 init；用占位，body 内对比 author/userId
        _vm = StateObject(wrappedValue: MomentsViewModel(myId: ""))
    }

    var body: some View {
        Group {
            if vm.loading && vm.moments.isEmpty {
                ProgressView()
            } else if vm.moments.isEmpty {
                Text("还没有朋友圈动态").foregroundColor(.vxinTextSecondary)
            } else {
                List {
                    ForEach(vm.moments) { m in
                        MomentCard(
                            moment: m,
                            isMine: m.userId == (session.currentUser?.id ?? ""),
                            commenting: commentingId == m.id,
                            commentText: $commentText,
                            onLike: { vm.toggleLike(m) },
                            onComment: { commentingId = (commentingId == m.id ? nil : m.id); commentText = "" },
                            onSubmitComment: { vm.comment(m, text: commentText); commentingId = nil; commentText = "" },
                            onDelete: { deleteTarget = m }
                        )
                        .onAppear { if m.id == vm.moments.last?.id { vm.loadMore() } }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("朋友圈")
        .navigationBarTitleDisplayMode(.inline)
        .task { vm.myId = session.currentUser?.id ?? ""; await vm.refresh() }
        .alert("删除动态", isPresented: .constant(deleteTarget != nil)) {
            Button("取消", role: .cancel) { deleteTarget = nil }
            Button("删除", role: .destructive) { if let m = deleteTarget { vm.delete(m) }; deleteTarget = nil }
        } message: { Text("确认删除这条朋友圈？") }
    }
}

private struct MomentCard: View {
    let moment: Moment
    let isMine: Bool
    let commenting: Bool
    @Binding var commentText: String
    var onLike: () -> Void
    var onComment: () -> Void
    var onSubmitComment: () -> Void
    var onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                InitialAvatar(name: moment.author.username.isEmpty ? "?" : moment.author.username, size: 40)
                Text(moment.author.username.isEmpty ? "未命名" : moment.author.username)
                    .foregroundColor(.vxinGreen).font(.subheadline)
                Spacer()
            }
            if !moment.content.isEmpty { Text(moment.content) }
            if !moment.images.isEmpty { imageGrid }
            HStack {
                Text(formatChatTime(moment.createdAt)).font(.caption2).foregroundColor(.vxinTextSecondary)
                Spacer()
                Button(moment.liked ? "已赞" : "赞") { onLike() }.buttonStyle(.borderless).foregroundColor(.vxinGreen)
                Button("评论") { onComment() }.buttonStyle(.borderless).foregroundColor(.vxinGreen)
                if isMine { Button("删除", role: .destructive) { onDelete() }.buttonStyle(.borderless) }
            }
            if !moment.likes.isEmpty {
                Text("❤ " + moment.likes.map { $0.username.isEmpty ? "用户" : $0.username }.joined(separator: "，"))
                    .font(.footnote).foregroundColor(.vxinGreen)
                    .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.gray.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 6))
            }
            ForEach(moment.comments) { c in
                (Text("\(c.username.isEmpty ? "用户" : c.username)：").foregroundColor(.vxinGreen) + Text(c.content))
                    .font(.footnote)
            }
            if commenting {
                HStack {
                    TextField("评论…", text: $commentText).textFieldStyle(.roundedBorder)
                    Button("发送") { onSubmitComment() }.disabled(commentText.isEmpty).foregroundColor(.vxinGreen)
                }
            }
        }
        .padding(.vertical, 6)
    }

    @ViewBuilder private var imageGrid: some View {
        let cols = moment.images.count == 1 ? 1 : 3
        let rows = stride(from: 0, to: moment.images.count, by: cols).map { Array(moment.images[$0..<min($0 + cols, moment.images.count)]) }
        VStack(spacing: 4) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, rowImgs in
                HStack(spacing: 4) {
                    ForEach(rowImgs, id: \.self) { img in
                        KFImage(URL(string: MediaUrlResolver.resolve(img) ?? ""))
                            .resizable().scaledToFill()
                            .frame(maxWidth: .infinity).aspectRatio(1, contentMode: .fit)
                            .clipped().clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                    ForEach(0..<(cols - rowImgs.count), id: \.self) { _ in Color.clear.frame(maxWidth: .infinity).aspectRatio(1, contentMode: .fit) }
                }
            }
        }
    }
}
