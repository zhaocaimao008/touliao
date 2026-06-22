import SwiftUI
import Combine
import Kingfisher

@MainActor
final class MomentsViewModel: ObservableObject {
    @Published var moments: [Moment] = []
    @Published var loading = true
    @Published var reachedEnd = false
    @Published var error: String?

    private let repo = MomentRepository.shared
    private let page = 20
    private var cancellables = Set<AnyCancellable>()
    var myId: String

    init(myId: String) {
        self.myId = myId
        repo.eventsPublisher
            .sink { [weak self] in Task { @MainActor in await self?.refresh() } }
            .store(in: &cancellables)
    }

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
    @State private var showCompose = false
    @State private var gallery: GalleryData?

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
                            onDelete: { deleteTarget = m },
                            onImageTap: { idx in gallery = GalleryData(images: m.images.map { MediaUrlResolver.resolve($0) ?? "" }, start: idx) }
                        )
                        .onAppear { if m.id == vm.moments.last?.id { vm.loadMore() } }
                    }
                }
                .listStyle(.plain)
                .refreshable { await vm.refresh() }
            }
        }
        .navigationTitle("朋友圈")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { showCompose = true } label: { Image(systemName: "camera") }
            }
        }
        .sheet(isPresented: $showCompose) {
            MomentComposeView(onPublished: { showCompose = false; Task { await vm.refresh() } })
        }
        .fullScreenCover(item: $gallery) { g in
            MomentGalleryView(images: g.images, start: g.start) { gallery = nil }
        }
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
    var onImageTap: (Int) -> Void = { _ in }

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
        let rowStarts = Array(stride(from: 0, to: moment.images.count, by: cols))
        VStack(spacing: 4) {
            ForEach(rowStarts, id: \.self) { rowStart in
                let end = min(rowStart + cols, moment.images.count)
                HStack(spacing: 4) {
                    ForEach(rowStart..<end, id: \.self) { i in
                        KFImage(URL(string: MediaUrlResolver.resolve(moment.images[i]) ?? ""))
                            .resizable().scaledToFill()
                            .frame(maxWidth: .infinity).aspectRatio(1, contentMode: .fit)
                            .clipped().clipShape(RoundedRectangle(cornerRadius: 6))
                            .onTapGesture { onImageTap(i) }
                    }
                    ForEach(0..<(cols - (end - rowStart)), id: \.self) { _ in Color.clear.frame(maxWidth: .infinity).aspectRatio(1, contentMode: .fit) }
                }
            }
        }
    }
}

struct GalleryData: Identifiable {
    let id = UUID()
    let images: [String]
    let start: Int
}

/// 朋友圈多图全屏查看：左右滑 + 双指缩放。
private struct MomentGalleryView: View {
    let images: [String]
    let start: Int
    var onClose: () -> Void
    @State private var page = 0
    @State private var scale: CGFloat = 1

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            TabView(selection: $page) {
                ForEach(Array(images.enumerated()), id: \.offset) { idx, url in
                    KFImage(URL(string: url))
                        .resizable().scaledToFit()
                        .scaleEffect(idx == page ? scale : 1)
                        .gesture(MagnificationGesture().onChanged { scale = max(1, min($0, 4)) }.onEnded { _ in if scale < 1 { scale = 1 } })
                        .tag(idx)
                        .onTapGesture { onClose() }
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()
            HStack {
                Button { onClose() } label: { Image(systemName: "xmark").foregroundColor(.white).padding() }
                Spacer()
                Text("\(page + 1)/\(images.count)").foregroundColor(.white).padding()
            }
        }
        .onAppear { page = min(max(start, 0), max(images.count - 1, 0)) }
    }
}
