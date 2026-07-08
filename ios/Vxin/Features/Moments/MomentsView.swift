import SwiftUI
import Combine
import Kingfisher

@MainActor
final class MomentsViewModel: ObservableObject {
    @Published var moments: [Moment] = []
    @Published var loading = true
    @Published var reachedEnd = false
    @Published var visibleDays = 0           // 朋友圈"最近 N 天可见"：0=全部
    @Published var error: String?
    // 互动通知（谁赞了/评论了我的动态）
    @Published var notifUnread = 0
    @Published var notifications: [MomentNotification] = []
    @Published var notifLoading = false

    private let repo = MomentRepository.shared
    private let page = 20
    private var cancellables = Set<AnyCancellable>()
    var myId: String

    init(myId: String) {
        self.myId = myId
        repo.eventsPublisher
            .sink { [weak self] in Task { @MainActor in await self?.refresh(); await self?.loadNotifUnread() } }
            .store(in: &cancellables)
        Task { await loadSettings(); await loadNotifUnread() }
    }

    // ── 互动通知（谁赞了/评论了我的动态）──
    func loadNotifUnread() async {
        if let n = try? await repo.notifUnreadCount() { notifUnread = n }
    }

    func openNotif() {
        notifLoading = true
        Task {
            do {
                notifications = try await repo.notifications(limit: 30).items
                // 打开即标记已读，清零角标
                if notifUnread > 0 { try? await repo.markNotificationsRead(); notifUnread = 0 }
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "加载失败" }
            notifLoading = false
        }
    }

    // ── 朋友圈"最近 N 天可见" ──
    func loadSettings() async {
        if let s = try? await ProfileRepository.shared.settings() { visibleDays = s.momentsVisibleDays }
    }

    func setVisibleDays(_ days: Int) {
        visibleDays = days
        Task {
            do { try await ProfileRepository.shared.setMomentsVisibleDays(days) }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "设置失败" }
        }
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
                if resp.liked { Haptics.impact(.light) }   // 主动点赞轻震
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

    func comment(_ m: Moment, text: String, replyToUser: String = "") {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        Task {
            do {
                let c = try await repo.comment(m.id, content: t, replyToUser: replyToUser)
                if let idx = moments.firstIndex(where: { $0.id == m.id }) {
                    moments[idx].comments.append(c)
                    moments[idx].commentCount += 1
                }
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "评论失败" }
        }
    }

    // 热门动态：timeline 只返回前 N 条评论，点「查看全部」时分页拉全量替换
    func loadAllComments(_ m: Moment) {
        Task {
            var all: [MomentComment] = []
            var offset = 0
            while true {
                guard let page = try? await repo.comments(m.id, limit: 50, offset: offset) else { break }
                all.append(contentsOf: page.items)
                if !page.hasMore || page.items.isEmpty { break }
                offset += 50
            }
            if let idx = moments.firstIndex(where: { $0.id == m.id }) {
                moments[idx].comments = all
                moments[idx].commentCount = all.count
            }
        }
    }

    func delete(_ m: Moment) {
        Task {
            do { try await repo.delete(m.id); moments.removeAll { $0.id == m.id } }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "删除失败" }
        }
    }

    /// 删除自己的评论(对齐 web/安卓：长按自己评论 → 删除)
    func deleteComment(_ m: Moment, _ c: MomentComment) {
        Task {
            do {
                try await repo.deleteComment(c.id)
                if let idx = moments.firstIndex(where: { $0.id == m.id }) {
                    moments[idx].comments.removeAll { $0.id == c.id }
                    moments[idx].commentCount = max(0, moments[idx].commentCount - 1)
                }
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "删除失败" }
        }
    }
}

struct MomentsView: View {
    @EnvironmentObject private var session: SessionStore
    @StateObject private var vm: MomentsViewModel
    @State private var commentingId: String?
    @State private var commentText = ""
    @State private var replyTarget: MomentComment?   // 回复某条评论(nil=普通评论)
    @State private var deleteTarget: Moment?
    @State private var deleteCommentTarget: (moment: Moment, comment: MomentComment)?
    @State private var showCompose = false
    @State private var showSettings = false
    @State private var showNotif = false
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
                            onComment: { commentingId = (commentingId == m.id ? nil : m.id); commentText = ""; replyTarget = nil },
                            onSubmitComment: {
                                vm.comment(m, text: commentText, replyToUser: replyTarget?.userId ?? "")
                                commentingId = nil; commentText = ""; replyTarget = nil
                            },
                            onDelete: { deleteTarget = m },
                            onViewAllComments: { vm.loadAllComments(m) },
                            onImageTap: { idx in gallery = GalleryData(images: m.images.map { MediaUrlResolver.resolve($0) ?? "" }, start: idx) },
                            myId: vm.myId,
                            onDeleteComment: { c in deleteCommentTarget = (m, c) },
                            replyTargetName: commentingId == m.id ? (replyTarget?.username ?? "") : "",
                            onReplyComment: { c in
                                if c.userId != vm.myId { replyTarget = c; commentingId = m.id }
                            }
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
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                // 互动通知入口：铃铛 + 未读角标
                Button { vm.openNotif(); showNotif = true } label: {
                    Image(systemName: "bell")
                        .overlay(alignment: .topTrailing) {
                            if vm.notifUnread > 0 {
                                Text(vm.notifUnread > 99 ? "99+" : "\(vm.notifUnread)")
                                    .font(.system(size: 9)).foregroundColor(.white)
                                    .padding(.horizontal, 4).padding(.vertical, 1)
                                    .background(Color.vxinError).clipShape(Capsule())
                                    .offset(x: 8, y: -6)
                            }
                        }
                }
                .accessibilityLabel("互动消息")
                Button { showSettings = true } label: { Image(systemName: "gearshape") }
                    .accessibilityLabel("朋友圈设置")
                Button { showCompose = true } label: { Image(systemName: "camera") }
                    .accessibilityLabel("发朋友圈")
            }
        }
        .sheet(isPresented: $showNotif) {
            MomentNotifSheet(loading: vm.notifLoading, items: vm.notifications)
        }
        .sheet(isPresented: $showCompose) {
            MomentComposeView(onPublished: { showCompose = false; Task { await vm.refresh() } })
        }
        .sheet(isPresented: $showSettings) {
            NavigationStack {
                List {
                    Section("允许朋友查看朋友圈的范围") {
                        ForEach([(0, "全部"), (1, "最近一天"), (3, "最近三天"), (30, "最近一个月")], id: \.0) { day, label in
                            Button { vm.setVisibleDays(day) } label: {
                                HStack {
                                    Text(label).foregroundColor(.primary)
                                    Spacer()
                                    if vm.visibleDays == day { Image(systemName: "checkmark").foregroundColor(.vxinGreen) }
                                }
                            }
                        }
                    }
                }
                .navigationTitle("朋友圈设置").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { showSettings = false } } }
            }
        }
        .fullScreenCover(item: $gallery) { g in
            MomentGalleryView(images: g.images, start: g.start) { gallery = nil }
        }
        .task { vm.myId = session.currentUser?.id ?? ""; await vm.refresh() }
        .toast($vm.error)
        .alert("删除动态", isPresented: .constant(deleteTarget != nil)) {
            Button("取消", role: .cancel) { deleteTarget = nil }
            Button("删除", role: .destructive) { if let m = deleteTarget { vm.delete(m) }; deleteTarget = nil }
        } message: { Text("确认删除这条朋友圈？") }
        .alert("删除评论", isPresented: .constant(deleteCommentTarget != nil)) {
            Button("取消", role: .cancel) { deleteCommentTarget = nil }
            Button("删除", role: .destructive) {
                if let t = deleteCommentTarget { vm.deleteComment(t.moment, t.comment) }
                deleteCommentTarget = nil
            }
        } message: { Text("确认删除这条评论？") }
    }
}

private struct MomentCard: View {
    let moment: Moment
    let isMine: Bool
    let commenting: Bool
    @Binding var commentText: String
    @FocusState private var commentFocused: Bool
    var onLike: () -> Void
    var onComment: () -> Void
    var onSubmitComment: () -> Void
    var onDelete: () -> Void
    var onViewAllComments: () -> Void = {}
    var onImageTap: (Int) -> Void = { _ in }
    var myId: String = ""
    var onDeleteComment: (MomentComment) -> Void = { _ in }
    var replyTargetName: String = ""
    var onReplyComment: (MomentComment) -> Void = { _ in }

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
                Button { onLike() } label: {
                    // 心形图标 + 文案(对齐微信/安卓 ❤️/🤍)
                    Label(moment.liked ? "已赞" : "赞", systemImage: moment.liked ? "heart.fill" : "heart")
                        .foregroundColor(moment.liked ? .vxinError : .vxinGreen)
                }.buttonStyle(.borderless)
                Button { onComment() } label: {
                    Label("评论", systemImage: "bubble.right")
                }.buttonStyle(.borderless).foregroundColor(.vxinGreen)
                if isMine { Button("删除", role: .destructive) { onDelete() }.buttonStyle(.borderless) }
            }
            if !moment.likes.isEmpty {
                Text("❤ " + moment.likes.map { $0.username.isEmpty ? "用户" : $0.username }.joined(separator: "，"))
                    .font(.footnote).foregroundColor(.vxinGreen)
                    .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.gray.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 6))
            }
            ForEach(moment.comments) { c in
                commentText(c)
                    .font(.footnote)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                    // 点非自己的评论 → 回复该人(对齐 web/安卓)
                    .onTapGesture { if c.userId != myId { onReplyComment(c) } }
                    .contextMenu {
                        // 长按自己的评论 → 删除(对齐 web/安卓)
                        if !myId.isEmpty && c.userId == myId {
                            Button(role: .destructive) { onDeleteComment(c) } label: { Label("删除", systemImage: "trash") }
                        }
                    }
            }
            // 热门动态：timeline 只返回前 N 条，按需加载全部
            if moment.commentCount > moment.comments.count {
                Button("查看全部 \(moment.commentCount) 条评论") { onViewAllComments() }
                    .font(.footnote).foregroundColor(.vxinGreen)
            }
            if commenting {
                HStack {
                    TextField(replyTargetName.isEmpty ? "评论…" : "回复 \(replyTargetName)…", text: $commentText)
                        .textFieldStyle(.roundedBorder)
                        .focused($commentFocused)
                        .submitLabel(.send)
                        .onSubmit { if !commentText.isEmpty { onSubmitComment() } }
                    Button("发送") { onSubmitComment() }.disabled(commentText.isEmpty).foregroundColor(.vxinGreen)
                }
                // 展开评论框时自动聚焦并弹出键盘(对齐微信/安卓)
                .onAppear { commentFocused = true }
            }
        }
        .padding(.vertical, 6)
    }

    /// 一条评论文本：「昵称 回复 X：内容」，回复段仅在有被回复人时出现
    private func commentText(_ c: MomentComment) -> Text {
        let name = Text("\(c.username.isEmpty ? "用户" : c.username)").foregroundColor(.vxinGreen)
        if !c.replyToUsername.isEmpty {
            return name
                + Text(" 回复 ").foregroundColor(.secondary)
                + Text(c.replyToUsername).foregroundColor(.vxinGreen)
                + Text("：\(c.content)")
        }
        return name + Text("：\(c.content)")
    }

    @ViewBuilder private var imageGrid: some View {
        // 单图：限制最大尺寸不铺满(对齐微信 + 安卓)，保留原图比例
        if moment.images.count == 1 {
            KFImage(source: MediaUrlResolver.kfSource(raw: moment.images[0]))
                .resizable().scaledToFit()
                .frame(maxWidth: 220, maxHeight: 280, alignment: .leading)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .onTapGesture { onImageTap(0) }
        } else {
            let cols = 3
            let rowStarts = Array(stride(from: 0, to: moment.images.count, by: cols))
            VStack(spacing: 4) {
                ForEach(rowStarts, id: \.self) { rowStart in
                    let end = min(rowStart + cols, moment.images.count)
                    HStack(spacing: 4) {
                        ForEach(rowStart..<end, id: \.self) { i in
                            KFImage(source: MediaUrlResolver.kfSource(raw: moment.images[i]))
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
                    KFImage(source: MediaUrlResolver.kfSource(resolved: url))
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
                    .accessibilityLabel("关闭")
                Spacer()
                Text("\(page + 1)/\(images.count)").foregroundColor(.white).padding()
            }
        }
        .onAppear { page = min(max(start, 0), max(images.count - 1, 0)) }
    }
}

/// 互动通知列表面板（谁赞了/评论了我的动态）—— 对齐 web「互动消息」
private struct MomentNotifSheet: View {
    let loading: Bool
    let items: [MomentNotification]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if items.isEmpty {
                    Text("暂无互动消息").foregroundColor(.vxinTextSecondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(items) { n in
                        HStack(spacing: 12) {
                            InitialAvatar(name: n.actor.username.isEmpty ? "?" : n.actor.username, size: 40)
                            VStack(alignment: .leading, spacing: 3) {
                                (Text(n.actor.username.isEmpty ? "用户" : n.actor.username).fontWeight(.medium)
                                    + Text(n.type == "like" ? " 赞了你的动态" : " 评论：\(n.commentContent)"))
                                    .font(.footnote).lineLimit(2)
                                Text(formatChatTime(n.createdAt)).font(.caption2).foregroundColor(.vxinTextSecondary)
                            }
                            Spacer()
                            if !n.moment.thumb.isEmpty {
                                KFImage(source: MediaUrlResolver.kfSource(raw: n.moment.thumb))
                                    .resizable().scaledToFill()
                                    .frame(width: 40, height: 40).clipShape(RoundedRectangle(cornerRadius: 4))
                            } else if !n.moment.content.isEmpty {
                                Text(String(n.moment.content.prefix(12)))
                                    .font(.caption2).foregroundColor(.vxinTextSecondary)
                                    .frame(maxWidth: 80, alignment: .trailing).lineLimit(2)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("互动消息").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
    }
}
