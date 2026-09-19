import XCTest
import SwiftUI
import UIKit
import AVFoundation
import Kingfisher
@testable import Touliao

/// Native SwiftUI / UIKit snapshots with a test-only network transport. No live accounts.
private final class ReviewURLProtocol: URLProtocol {
    static var fixtures: [String: Any] = [:]
    static var paths = Set<String>()
    static var uploads: [(URLRequest, Data)] = []
    static let lock = NSLock()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url?.path ?? ""
        Self.lock.lock(); Self.paths.insert(path); Self.lock.unlock()
        if path.hasSuffix("/upload") {
            var bytes = request.httpBody ?? Data()
            if let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 8192)
                while true {
                    let count = stream.read(&buffer, maxLength: buffer.count)
                    if count <= 0 { break }
                    bytes.append(contentsOf: buffer.prefix(count))
                }
            }
            Self.lock.lock(); Self.uploads.append((request, bytes)); Self.lock.unlock()
        }
        let value: Any
        if let fixture = Self.fixtures[path] { value = fixture }
        else if path.hasSuffix("/sync") { value = ["messages": [], "cursor": 0, "hasMore": false] }
        else if path.hasSuffix("/read-states") { value = ["states": [:]] }
        else if path.hasSuffix("/settings") || path == "/config.json" { value = [:] }
        else { value = [] }
        let payload = value as? [String: Any]
        let png = payload?["_reviewPNG"] as? String
        let raw = payload?["_reviewData"] as? String
        let bytes = raw.flatMap { Data(base64Encoded: $0) } ?? png.flatMap { Data(base64Encoded: $0) } ?? (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8)
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                       headerFields: ["Content-Type": (payload?["_reviewContentType"] as? String) ?? (png == nil ? "application/json" : "image/png")])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: bytes)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor
final class NativeUIReviewTests: XCTestCase {
    private var output: URL!
    private var oldServer: String?
    private var oldToken: String?
    private var oldActive: String?
    private var oldReviewAccount: StoredAccount?
    private var session: SessionStore!
    private var oldImageConfiguration: URLSessionConfiguration?

    override func setUpWithError() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixtures", withExtension: "json"))
        ReviewURLProtocol.fixtures = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any] ?? [:]
        // Group and rich-message views must render populated histories, not empty fixtures.
        if let messages = ReviewURLProtocol.fixtures["/api/messages/review-chat"] as? [[String: Any]] {
            ReviewURLProtocol.fixtures["/api/messages/review-group"] = messages.map { original in
                var message = original; message["conversation_id"] = "review-group"
                return message
            }
        }
        let image = UIGraphicsImageRenderer(size: CGSize(width: 120, height: 80)).image { context in
            UIColor.systemBlue.setFill(); context.fill(CGRect(x: 0, y: 0, width: 120, height: 80))
        }
        ReviewURLProtocol.fixtures["/uploads/ui-image.png"] = ["_reviewPNG": try XCTUnwrap(image.pngData()).base64EncodedString()]
        for type in ["image", "video", "voice", "file", "reply"] {
            let conversation = "review-" + type
            var message: [String: Any] = ["id": conversation + "-message", "conversation_id": conversation,
                "sender_id": "review-me", "senderName": "林清", "type": type == "reply" ? "text" : type,
                "created_at": Date().timeIntervalSince1970, "content": "项目设计说明.pdf", "file_size": 24576,
                "file_url": "/uploads/ui-image.png", "duration": 12]
            if type == "video", let movie = Bundle(for: Self.self).url(forResource: "ui-preview", withExtension: "mp4") {
                message["file_url"] = "https://native-review.invalid/uploads/ui-video.mp4"
                ReviewURLProtocol.fixtures["/uploads/ui-video.mp4"] = ["_reviewData": try Data(contentsOf: movie).base64EncodedString(), "_reviewContentType": "video/mp4"]
                message["content"] = "视频.mp4"
            }
            if type == "reply" {
                message["content"] = "@李明 收到，稍后确认。"
                message["replyTo"] = ["id": "quoted", "type": "text", "content": "请确认新版界面", "senderName": "李明", "deleted": 0]
            }
            ReviewURLProtocol.fixtures["/api/messages/" + conversation] = [message]
        }
        ReviewURLProtocol.uploads = []
        URLProtocol.registerClass(ReviewURLProtocol.self)
        // Kingfisher owns an ephemeral session, so global URLProtocol registration
        // alone does not isolate its requests. Configure only the test transport.
        oldImageConfiguration = ImageDownloader.default.sessionConfiguration
        let imageConfiguration = URLSessionConfiguration.ephemeral
        imageConfiguration.protocolClasses = [ReviewURLProtocol.self]
        ImageDownloader.default.sessionConfiguration = imageConfiguration
        oldServer = UserDefaults.standard.string(forKey: "vxin_base_url_override")
        ServerConfig.shared.baseURL = "https://native-review.invalid"
        oldToken = KeychainStore.shared.token
        KeychainStore.shared.token = "native-ui-review-only"
        XCTAssertEqual(try XCTUnwrap(KeychainStore.shared.token, "Simulator test host requires ad hoc Keychain entitlements"), "native-ui-review-only")
        oldActive = AccountStore.shared.activeId()
        oldReviewAccount = AccountStore.shared.accounts().first { $0.id == "review-me" }
        AccountStore.shared.upsertActive(StoredAccount(id: "review-me", username: "林清", avatar: "", token: "native-ui-review-only"))
        session = SessionStore()
        output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("NativeUiReview")
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws {
        SocketService.shared.disconnect()
        KeychainStore.shared.token = oldToken
        AccountStore.shared.remove("review-me")
        if let oldReviewAccount { AccountStore.shared.upsertActive(oldReviewAccount) }
        UserDefaults.standard.set(oldActive, forKey: "touliao_active_account_id")
        UserDefaults.standard.set(oldServer, forKey: "vxin_base_url_override")
        URLProtocol.unregisterClass(ReviewURLProtocol.self)
        if let oldImageConfiguration { ImageDownloader.default.sessionConfiguration = oldImageConfiguration }
    }

    func testNativeScreenGallery() async throws {
        await session.restoreSession()
        XCTAssertEqual(try XCTUnwrap(session.currentUser).id, "review-me")
        for dark in [false, true] {
            for (name, view) in screens() {
                try await capture(view, name: name + (dark ? "-dark" : "-light"), dark: dark)
            }
        }
        for (name, view) in screens().filter({ ["login", "register", "contacts", "chat", "group-chat", "file-detail", "toast", "appearance", "settings"].contains($0.0) }) {
            try await capture(view, name: name + "-dark-large-text", dark: true, large: true, width: 320)
        }
        ReviewURLProtocol.lock.lock(); let paths = ReviewURLProtocol.paths.sorted(); ReviewURLProtocol.lock.unlock()
        XCTAssertTrue(paths.contains("/api/auth/me"))
        XCTAssertTrue(paths.contains("/api/messages/review-chat"), "Gallery must load real ChatViewModel history through the test transport")
        XCTAssertTrue(paths.contains("/uploads/ui-image.png"), "Image messages must download image bytes through the isolated transport")
        try JSONSerialization.data(withJSONObject: ["environment": "iOS Simulator — native UIHostingController", "requestsIntercepted": paths], options: .prettyPrinted)
            .write(to: output.appendingPathComponent("environment.json"))
    }

    func testCallControlLayoutAtLargeText() async throws {
        let controls = AnyView(
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 3), spacing: 20) {
                ForEach(["静音", "取消静音", "扬声器", "听筒", "切视频", "挂断", "开摄像头", "翻转", "接听"], id: \.self) { label in
                    CallActionButton(label: label, color: label == "挂断" ? .vxinCallDanger : Color(white: 0.35), action: {})
                }
            }.padding(16).frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(white: 0.1))
        )
        try await capture(controls, name: "call-controls-dark", dark: true)
        try await capture(controls, name: "call-controls-dark-large-text", dark: true, large: true, width: 320)
    }


    func testImageVideoAndFilePreviewRouting() async throws {
        let vm = ChatViewModel(conversationId: "review-chat", title: "测试", myId: "review-me")
        await vm.loadHistory()
        var image = Message(cachedId: "image", conversationId: "review-chat", senderId: "review-me")
        image.type = "image"; image.fileUrl = "/uploads/image.png"
        vm.messages = [image]
        vm.openImage(image)
        XCTAssertEqual(vm.galleryStart, 0)
        XCTAssertTrue(try XCTUnwrap(vm.galleryImages?.first).contains("/uploads/image.png"))
        XCTAssertTrue(try XCTUnwrap(vm.galleryImages?.first).contains("token="))
        var video = image; video.type = "video"; video.fileUrl = "/uploads/video.mp4"; video.content = "视频.mp4"
        vm.openAttachment(video)
        XCTAssertTrue(try XCTUnwrap(vm.videoPreview?.url).contains("/uploads/video.mp4"))
        XCTAssertNil(vm.fileDetails)
        var pdf = image; pdf.type = "file"; pdf.fileUrl = "/uploads/report.pdf"; pdf.content = "说明.pdf"
        vm.openAttachment(pdf)
        XCTAssertNotNil(vm.pdfPreview)
        var file = pdf; file.content = "资料.zip"; file.fileUrl = "/uploads/archive.zip"
        vm.openAttachment(file)
        XCTAssertEqual(vm.fileDetails?.name, "资料.zip")
        vm.appendEmoji("😀")
        XCTAssertTrue(vm.input.hasSuffix("😀"))
    }

    func testMediaUploadAndVideoDownloadWithIsolatedTransport() async throws {
        let movie = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "ui-preview", withExtension: "mp4"))
        let bytes = try Data(contentsOf: movie)
        let uploadPath = "/api/messages/review-chat/upload"
        let image = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8)).image { context in
            UIColor.blue.setFill(); context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
        for (type, mime, name, data) in [
            ("image", "image/png", "image.png", try XCTUnwrap(image.pngData())),
            ("voice", "audio/mp4", "voice.m4a", Data("isolated-audio-body".utf8)),
            ("file", "text/plain", "readme.txt", Data("UI regression".utf8)),
            ("video", "video/mp4", "preview.mp4", bytes)
        ] {
            ReviewURLProtocol.fixtures[uploadPath] = ["id": "uploaded-" + type, "type": type,
                "conversation_id": "review-chat", "sender_id": "review-me", "content": name,
                "file_url": "/uploads/" + name, "duration": type == "voice" ? 2 : 0]
            let message: Message
            if type == "video" {
                message = try await ChatRepository.shared.uploadMediaFile(conversationId: "review-chat", fileURL: movie, fileName: name, mimeType: mime)
            } else {
                message = try await ChatRepository.shared.uploadMedia(conversationId: "review-chat", data: data, fileName: name, mimeType: mime, duration: type == "voice" ? 2 : 0)
            }
            XCTAssertEqual(message.type, type)
            let upload = try XCTUnwrap(ReviewURLProtocol.uploads.last)
            XCTAssertEqual(upload.0.httpMethod, "POST")
            XCTAssertEqual(upload.0.value(forHTTPHeaderField: "Authorization"), "Bearer native-ui-review-only")
            XCTAssertNotNil(upload.1.range(of: Data(("Content-Type: " + mime).utf8)))
            XCTAssertNotNil(upload.1.range(of: data), "The entire media body must reach the upload transport")
            if type == "voice" {
                XCTAssertNotNil(upload.1.range(of: Data("name=\"duration\"".utf8)))
            }
        }
        ReviewURLProtocol.fixtures["/uploads/preview.mp4"] = ["_reviewData": bytes.base64EncodedString(), "_reviewContentType": "video/mp4"]
        let downloaded = try await FileShareHelper.prepareShareFile(rawUrl: "/uploads/preview.mp4", filename: "ui-test-preview.mp4", isImage: false)
        defer { try? FileManager.default.removeItem(at: downloaded) }
        XCTAssertEqual(try Data(contentsOf: downloaded), bytes)
        let duration = try await AVURLAsset(url: downloaded).load(.duration)
        XCTAssertGreaterThan(CMTimeGetSeconds(duration), 0)
        try await capture(AnyView(VideoPlayerOverlay(url: downloaded.absoluteString, filename: "视频预览", onDismiss: {})), name: "video-preview", dark: true)
    }

    func testGroupIncomingBannerAtLargeText() async throws {
        let manager = GroupCallManager.shared
        let previous = manager.pendingInvite
        defer { manager.pendingInvite = previous }
        manager.pendingInvite = GroupCallInvite(callId: "review-invite", conversationId: "review-group", type: "video", from: "review-li", fromName: "产品设计讨论群成员")
        try await capture(AnyView(GroupCallHostView()), name: "group-incoming-large-text", dark: true, large: true, width: 320)
    }

    func testNativeComposerKeyboardChineseInputAndMultilineHeight() async throws {
        let oldDraft = DraftStore.shared.get("review-chat")
        DraftStore.shared.clear("review-chat")
        defer { DraftStore.shared.set("review-chat", oldDraft) }
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        let view = NavigationStack {
            ChatView(conversation: Conversation(id: "review-chat", name: "键盘回归"), myId: "review-me")
        }.environmentObject(session!)
        let host = UIHostingController(rootView: view)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { host.view.endEditing(true); window.isHidden = true; window.rootViewController = nil }
        try await Task.sleep(nanoseconds: 900_000_000)
        let input = try XCTUnwrap(descendants(host.view).compactMap { $0 as? UITextView }.first { !$0.isHidden && $0.bounds.width > 0 })
        XCTAssertTrue(input.becomeFirstResponder())
        try await Task.sleep(nanoseconds: 600_000_000)
        let singleLineHeight = input.bounds.height
        input.setMarkedText("中文", selectedRange: NSRange(location: 2, length: 0))
        input.unmarkText()
        input.insertText("\n第二行 😀")
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertTrue(input.text.contains("中文"))
        XCTAssertTrue(input.text.contains("第二行 😀"))
        XCTAssertFalse(input.text.contains("\n"), "Preserve the existing pasted-newline normalization")
        input.insertText(String(repeating: "长文本输入高度检查", count: 8))
        try await Task.sleep(nanoseconds: 600_000_000)
        XCTAssertGreaterThan(input.bounds.height, singleLineHeight, "Long text must grow the composer beyond one line")
        let keyboard = host.view.keyboardLayoutGuide.layoutFrame
        let frame = input.convert(input.bounds, to: host.view)
        if keyboard.height > host.view.safeAreaInsets.bottom + 50 {
            XCTAssertLessThanOrEqual(frame.maxY, keyboard.minY + 1, "Composer must stay above the docked keyboard")
        }
        XCTAssertGreaterThanOrEqual(frame.minX, 0)
        XCTAssertLessThanOrEqual(frame.maxX, host.view.bounds.maxX + 1)
        host.view.endEditing(true)
        try await Task.sleep(nanoseconds: 350_000_000)
        XCTAssertFalse(input.isFirstResponder)
        XCTAssertTrue(input.text.contains("中文"), "Dismissing the keyboard must preserve the draft")
        let facts: [String: Any] = ["nativeTextEditing": true, "markedChineseAndNewline": true,
            "pastedNewlineNormalizationPreserved": true, "singleLineHeight": singleLineHeight,
            "wrappedTextHeight": input.bounds.height,
            "keyboardVisible": keyboard.height > host.view.safeAreaInsets.bottom + 50,
            "keyboardFrame": String(describing: keyboard), "inputFrame": String(describing: frame),
            "device": UIDevice.current.model, "hardware": false]
        try JSONSerialization.data(withJSONObject: facts, options: .prettyPrinted).write(to: output.appendingPathComponent("keyboard-validation.json"))
    }

    private func screens() -> [(String, AnyView)] {
        let conversation = Conversation(id: "review-chat", name: "李明")
        return [
            ("login", AnyView(LoginView())), ("register", AnyView(RegisterView())),
            ("forgot-password", AnyView(ForgotPasswordView())),
            ("conversations", AnyView(ConversationListView(myId: "review-me"))),
            ("chat", AnyView(ChatView(conversation: conversation, myId: "review-me"))),
            ("chat-attachments", AnyView(ChatView.iconReview(conversation: conversation, panel: "attachments"))),
            ("chat-emoji", AnyView(ChatView.iconReview(conversation: conversation, panel: "emoji"))),
            ("group-chat", AnyView(ChatView(conversation: Conversation(id: "review-group", type: "group", name: "投聊设计讨论"), myId: "review-me"))),
            ("file-detail", AnyView(FileDetailsOverlay(url: "https://native-review.invalid/uploads/review.zip", filename: "项目资料与设计说明.zip", sizeText: "2.4 MB", onDismiss: {}))),
            ("toast", AnyView(TouliaoToast(message: "文件上传失败，请检查网络后重试").padding(24))),
            ("image-message", AnyView(ChatView(conversation: Conversation(id: "review-image", name: "图片消息"), myId: "review-me"))),
            ("video-message", AnyView(ChatView(conversation: Conversation(id: "review-video", name: "视频消息"), myId: "review-me"))),
            ("voice-message", AnyView(ChatView(conversation: Conversation(id: "review-voice", name: "语音消息"), myId: "review-me"))),
            ("file-message", AnyView(ChatView(conversation: Conversation(id: "review-file", name: "文件消息"), myId: "review-me"))),
            ("reply-message", AnyView(ChatView(conversation: Conversation(id: "review-reply", name: "引用与提及"), myId: "review-me"))),
            ("files", AnyView(ConversationFilesView(conversationId: conversation.id))),
            ("mentions", AnyView(MentionsView(myId: "review-me", onOpenConversation: { _ in }))),
            ("contacts", AnyView(ContactsView(onStartChat: { _ in }, onAddFriend: {}, onRequests: {}, onCreateGroup: {}))),
            ("add-friend", AnyView(AddFriendView())), ("friend-requests", AnyView(FriendRequestsView())),
            ("create-group", AnyView(CreateGroupView(onCreated: { _ in }))),
            ("blocked", AnyView(BlockedView())), ("friend-labels", AnyView(FriendLabelsView())),
            ("group", AnyView(GroupInfoView(conversationId: "review-group", onInvite: {}, onLeft: {}))),
            ("invite-members", AnyView(InviteMembersView(conversationId: "review-group", onDone: {}))),
            ("search", AnyView(SearchView(onOpenResult: { _ in }))),
            ("my-qr", AnyView(MyQRCodeView())), ("group-qr", AnyView(GroupQrView(conversationId: "review-group"))),
            ("profile", AnyView(ProfileView())), ("edit-profile", AnyView(ProfileEditView())),
            ("settings", AnyView(SettingsHomeView())), ("appearance", AnyView(AppearanceSettingsView())),
            ("notifications", AnyView(NotificationSettingsView())), ("privacy", AnyView(PrivacySecurityView())),
            ("quiet-hours", AnyView(QuietSettingsView())), ("change-phone", AnyView(ChangePhoneView(currentPhone: "13800000000", onChanged: { _ in }))),
            ("change-password", AnyView(ChangePasswordView())), ("delete-account", AnyView(DeleteAccountView())),
            ("sessions", AnyView(SessionsView())), ("accounts", AnyView(AccountManagementView())),
            ("call-history", AnyView(CallHistoryView())), ("wallet", AnyView(WalletView())),
            ("favorites", AnyView(FavoritesView())), ("moments", AnyView(MomentsView())),
            ("compose-moment", AnyView(MomentComposeView(onPublished: {}))),
            ("invite-friend", AnyView(InviteFriendView()))
        ]
    }
    private func descendants(_ view: UIView) -> [UIView] {
        view.subviews.flatMap { [$0] + descendants($0) }
    }

    private func capture(_ view: AnyView, name: String, dark: Bool, large: Bool = false, width: CGFloat = 390) async throws {
        print("NATIVE_UI_CAPTURE \(name) width=\(width)"); fflush(stdout)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: width, height: 844)
        window.overrideUserInterfaceStyle = dark ? .dark : .light
        let content = NavigationStack { view }.tint(.vxinBrand).environmentObject(session!)
            .environment(\.colorScheme, dark ? .dark : .light)
            .environment(\.dynamicTypeSize, large ? .accessibility3 : .large)
        let host = UIHostingController(rootView: content)
        window.rootViewController = host
        window.makeKeyAndVisible()
        try await Task.sleep(nanoseconds: 700_000_000)
        // Capture the app canvas consistently. The system keyboard lives in a
        // separate window and is outside this view-rendering test's scope.
        host.view.endEditing(true)
        try await Task.sleep(nanoseconds: 350_000_000)
        if name.hasPrefix("group-chat-") {
            XCTAssertFalse(MsgCacheStore.shared.load("review-group").isEmpty, "Group screenshots must include loaded message history")
        }
        if name.hasPrefix("chat-") {
            let messages = MsgCacheStore.shared.load("review-chat")
            XCTAssertTrue(messages.contains { $0.content == "收到，稍后把文件发给你。" }, "Chat rendering requires successfully loaded history")
        }
        if name.hasPrefix("image-message-") {
            let loaded = try XCTUnwrap(ImageCache.default.retrieveImageInMemoryCache(forKey: "https://native-review.invalid/uploads/ui-image.png"), "A blank image placeholder must not count as a successful screenshot")
            XCTAssertGreaterThan(loaded.size.width, 0)
            XCTAssertEqual(loaded.size.width / loaded.size.height, 1.5, accuracy: 0.01)
        }
        host.view.setNeedsLayout(); host.view.layoutIfNeeded()
        if name.hasPrefix("chat-") || name.hasPrefix("group-chat-") {
            let fields = descendants(host.view).filter { $0 is UITextField || $0 is UITextView }
            let visible = fields.filter { !$0.isHidden && $0.alpha > 0 && $0.bounds.width > 0 }
            XCTAssertFalse(visible.isEmpty, "Chat must contain a native editable input")
            for field in visible {
                let frame = field.convert(field.bounds, to: host.view)
                XCTAssertGreaterThanOrEqual(frame.width, 100, "Input must not collapse between tool buttons")
                XCTAssertLessThanOrEqual(frame.maxY, host.view.bounds.maxY + 1)
                XCTAssertGreaterThanOrEqual(frame.minX, -1)
                XCTAssertLessThanOrEqual(frame.maxX, host.view.bounds.maxX + 1)
            }
        }

        let format = UIGraphicsImageRendererFormat(); format.scale = 2
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds, format: format).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        XCTAssertGreaterThan(image.size.width, 200)
        try XCTUnwrap(image.pngData()).write(to: output.appendingPathComponent(name + ".png"))
        let attachment = XCTAttachment(image: image); attachment.name = name; attachment.lifetime = .keepAlways
        add(attachment)
        window.isHidden = true; window.rootViewController = nil
    }
}
