import XCTest
import UIKit
import Kingfisher
@testable import Touliao

final class Batch3SessionMediaTests: XCTestCase {
    func testAccountAndServerScopedCacheSurvivesRestartWithoutCrossAccountReads() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var scope = "server1:A"
        let store = MsgCacheStore(directory: directory, accountScope: { scope })
        var message = Message(cachedId: "one", conversationId: "same-group", senderId: "A")
        message.content = "A-private-history"
        try store.saveBeforeCursor("same-group", [message])
        // Recreate the store: this is disk recovery, not merely a memory cache check.
        let restarted = MsgCacheStore(directory: directory, accountScope: { scope })
        XCTAssertEqual(restarted.load("same-group").first?.content, "A-private-history")
        scope = "server1:B"
        XCTAssertTrue(restarted.load("same-group").isEmpty)
        scope = "server2:A"
        XCTAssertTrue(restarted.load("same-group").isEmpty)
        scope = "server1:A"
        XCTAssertEqual(restarted.load("same-group").count, 1)
    }
    func testMediaResolverRemovesLegacyCredentialFromRelativeAndAbsolutePaths() {
        for raw in ["/uploads/files/a.mp4?token=synthetic-login", ServerConfig.shared.baseURL + "/uploads/files/a.mp4?token=synthetic-login"] {
            let resolved = MediaUrlResolver.resolve(raw)
            XCTAssertNotNil(resolved)
            XCTAssertFalse(resolved!.contains("synthetic-login"))
        }
    }
    /// 气泡降采样后的像素必须覆盖气泡在 2x/3x 屏上的实际像素(否则放大发糊)，同时远小于原图(省内存)。
    func testBubbleDownsamplingKeepsBubblePixelsSharpOn2xAnd3x() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        for source in [CGSize(width: 3000, height: 2000), CGSize(width: 2000, height: 3000)] {
            let big = UIGraphicsImageRenderer(size: source, format: format).image { context in
                UIColor.systemTeal.setFill(); context.fill(CGRect(origin: .zero, size: source))
            }
            let data = try XCTUnwrap(big.jpegData(compressionQuality: 0.8))
            for scale: CGFloat in [2, 3] {
                let options = KingfisherParsedOptionsInfo([.scaleFactor(scale)])
                let image = try XCTUnwrap(MediaUrlResolver.bubbleProcessor.process(item: .data(data), options: options))
                let cg = try XCTUnwrap(image.cgImage)
                let bubble = MediaUrlResolver.bubbleMaxPointSize
                // scaledToFit 在 220×280pt 框内：横图受宽度约束、竖图受高度约束。
                let fit = min(bubble.width / source.width, bubble.height / source.height)
                XCTAssertGreaterThanOrEqual(CGFloat(cg.width), (source.width * fit * scale).rounded(.down) - 1, "scale \(scale) \(source)")
                XCTAssertGreaterThanOrEqual(CGFloat(cg.height), (source.height * fit * scale).rounded(.down) - 1, "scale \(scale) \(source)")
                XCTAssertLessThanOrEqual(CGFloat(max(cg.width, cg.height)), max(bubble.width, bubble.height) * scale + 1)
            }
        }
    }

    func testMediaRequestDoesNotSendAccountTokenToAnotherOrigin() {
        var token: String? = "synthetic-login"
        let credentials = KeychainStore(readToken: { token }, writeToken: { token = $0 })
        let request = MediaUrlResolver.request(URL(string: "https://third-party.invalid/uploads/files/a")!, owner: credentials.snapshot())
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
    }
    func testConversationCodableAndDiskCacheRoundTripStripPreviewsAndIsolateAccounts() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        var item = Conversation(id: "same", type: "group", name: "Fixture")
        item.burnAfter = 30; item.manuallyUnread = 1; item.archived = 1; item.hasMention = true
        item.lastMessage = "private-preview"; item.lastSenderName = "private-sender"; item.lastMessageType = "text"
        item.otherUser = Conversation.OtherUser(id: "peer", username: "Fixture peer")
        let decoded = try JSONDecoder().decode(Conversation.self, from: JSONEncoder().encode(item))
        XCTAssertEqual(decoded, item)
        ConversationCache.save([item], id: "A", origin: "server1", directory: dir)
        let loaded = ConversationCache.load(id: "A", origin: "server1", directory: dir)
        XCTAssertEqual(loaded.count, 1); XCTAssertEqual(loaded[0].burnAfter, 30)
        XCTAssertEqual(loaded[0].manuallyUnread, 1); XCTAssertEqual(loaded[0].archived, 1)
        XCTAssertTrue(loaded[0].hasMention); XCTAssertEqual(loaded[0].otherUser, item.otherUser)
        XCTAssertNil(loaded[0].lastMessage); XCTAssertNil(loaded[0].lastMessageType); XCTAssertNil(loaded[0].lastSenderName)
        XCTAssertTrue(ConversationCache.load(id: "B", origin: "server1", directory: dir).isEmpty)
        XCTAssertTrue(ConversationCache.load(id: "A", origin: "server2", directory: dir).isEmpty)
        ConversationCache.save([Conversation(id: "B-only")], id: "B", origin: "server1", directory: dir)
        XCTAssertEqual(ConversationCache.load(id: "A", origin: "server1", directory: dir).first?.id, "same")
        // A truncated/corrupt file is discarded without reading another account's cache.
        try Data("{broken".utf8).write(to: ConversationCache.file("A", "server1", directory: dir))
        XCTAssertTrue(ConversationCache.load(id: "A", origin: "server1", directory: dir).isEmpty)
        XCTAssertEqual(ConversationCache.load(id: "B", origin: "server1", directory: dir).first?.id, "B-only")
    }
}
