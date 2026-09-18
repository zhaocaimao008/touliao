import XCTest
import SwiftUI
import UIKit
@testable import Touliao

/// Native SwiftUI / UIKit snapshots with a test-only network transport. No live accounts.
private final class ReviewURLProtocol: URLProtocol {
    static var fixtures: [String: Any] = [:]
    static var paths = Set<String>()
    static let lock = NSLock()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url?.path ?? ""
        Self.lock.lock(); Self.paths.insert(path); Self.lock.unlock()
        let value: Any
        if let fixture = Self.fixtures[path] { value = fixture }
        else if path.hasSuffix("/sync") { value = ["messages": [], "cursor": 0, "hasMore": false] }
        else if path.hasSuffix("/read-states") { value = ["states": [:]] }
        else if path.hasSuffix("/settings") || path == "/config.json" { value = [:] }
        else { value = [] }
        let bytes = (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8)
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
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
    private var session: SessionStore!

    override func setUpWithError() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixtures", withExtension: "json"))
        ReviewURLProtocol.fixtures = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any] ?? [:]
        URLProtocol.registerClass(ReviewURLProtocol.self)
        oldServer = UserDefaults.standard.string(forKey: "vxin_base_url_override")
        ServerConfig.shared.baseURL = "https://native-review.invalid"
        oldToken = KeychainStore.shared.token
        KeychainStore.shared.token = "native-ui-review-only"
        session = SessionStore()
        output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("NativeUiReview")
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws {
        SocketService.shared.disconnect()
        KeychainStore.shared.token = oldToken
        UserDefaults.standard.set(oldServer, forKey: "vxin_base_url_override")
        URLProtocol.unregisterClass(ReviewURLProtocol.self)
    }

    func testNativeScreenGallery() async throws {
        await session.restoreSession()
        for dark in [false, true] {
            for (name, view) in screens() {
                try await capture(view, name: name + (dark ? "-dark" : "-light"), dark: dark)
            }
        }
        for (name, view) in screens().filter({ ["login", "contacts", "chat", "appearance", "settings"].contains($0.0) }) {
            try await capture(view, name: name + "-dark-large-text", dark: true, large: true, width: 320)
        }
        ReviewURLProtocol.lock.lock(); let paths = ReviewURLProtocol.paths.sorted(); ReviewURLProtocol.lock.unlock()
        try JSONSerialization.data(withJSONObject: ["environment": "iOS Simulator — native UIHostingController", "requestsIntercepted": paths], options: .prettyPrinted)
            .write(to: output.appendingPathComponent("environment.json"))
    }

    func testCallControlLayoutAtLargeText() async throws {
        let controls = AnyView(
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 3), spacing: 20) {
                ForEach(["静音", "扬声器", "切视频", "挂断", "开摄像头", "翻转"], id: \.self) { label in
                    CallActionButton(label: label, color: label == "挂断" ? .vxinCallDanger : Color(white: 0.35), action: {})
                }
            }.padding(16).frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(white: 0.1))
        )
        try await capture(controls, name: "call-controls-dark", dark: true)
        try await capture(controls, name: "call-controls-dark-large-text", dark: true, large: true, width: 320)
    }

    private func screens() -> [(String, AnyView)] {
        let conversation = Conversation(id: "review-chat", name: "李明")
        return [
            ("login", AnyView(LoginView())), ("register", AnyView(RegisterView())),
            ("forgot-password", AnyView(ForgotPasswordView())),
            ("conversations", AnyView(ConversationListView(myId: "review-me"))),
            ("chat", AnyView(ChatView(conversation: conversation, myId: "review-me"))),
            ("files", AnyView(ConversationFilesView(conversationId: conversation.id))),
            ("mentions", AnyView(MentionsView(myId: "review-me", onOpenConversation: { _ in }))),
            ("contacts", AnyView(ContactsView(onStartChat: { _ in }, onAddFriend: {}, onRequests: {}, onCreateGroup: {}))),
            ("add-friend", AnyView(AddFriendView())), ("friend-requests", AnyView(FriendRequestsView())),
            ("create-group", AnyView(CreateGroupView(onCreated: { _ in }))),
            ("blocked", AnyView(BlockedView())), ("friend-labels", AnyView(FriendLabelsView())),
            ("group", AnyView(GroupInfoView(conversationId: "review-group", onInvite: {}, onLeft: {}))),
            ("invite-members", AnyView(InviteMembersView(conversationId: "review-group", onDone: {}))),
            ("search", AnyView(SearchView(onOpenResult: { _ in }))),
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
    private func capture(_ view: AnyView, name: String, dark: Bool, large: Bool = false, width: CGFloat = 390) async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: width, height: 844)
        window.overrideUserInterfaceStyle = dark ? .dark : .light
        let content = NavigationStack { view }.environmentObject(session!)
            .environment(\.colorScheme, dark ? .dark : .light)
            .environment(\.dynamicTypeSize, large ? .accessibility3 : .large)
        let host = UIHostingController(rootView: content)
        window.rootViewController = host
        window.makeKeyAndVisible()
        try await Task.sleep(nanoseconds: 700_000_000)
        host.view.setNeedsLayout(); host.view.layoutIfNeeded()
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
