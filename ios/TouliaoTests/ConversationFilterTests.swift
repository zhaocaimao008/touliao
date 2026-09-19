import XCTest
@testable import Touliao

final class ConversationFilterTests: XCTestCase {
    func testUnreadFilterPreservesManualUnreadAndMutedConversations() {
        var conversation = Conversation(id: "test")
        XCTAssertFalse(ConversationFilter.unread.includes(conversation))
        conversation.manuallyUnread = 1
        XCTAssertTrue(ConversationFilter.unread.includes(conversation))
        conversation.manuallyUnread = 0
        conversation.unreadCount = 3; conversation.muted = 1
        XCTAssertTrue(ConversationFilter.unread.includes(conversation))
        XCTAssertTrue(ConversationFilter.all.includes(conversation))
    }

    func testGroupFilterDoesNotIncludePrivateChatsOrFileHelper() {
        XCTAssertTrue(ConversationFilter.groups.includes(Conversation(id: "g", type: "group")))
        for type in ["private", "filehelper"] {
            XCTAssertFalse(ConversationFilter.groups.includes(Conversation(id: type, type: type)))
        }
    }
}
