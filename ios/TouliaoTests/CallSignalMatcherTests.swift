import XCTest
@testable import Touliao

final class CallSignalMatcherTests: XCTestCase {
    func testRejectsStaleCallIdForSamePeer() {
        XCTAssertFalse(CallSignalMatcher.matches(activeCallId: "new", eventCallId: "old", activePeerId: "bob", eventPeerId: "bob"))
    }

    func testAcceptsCurrentCallAndPeer() {
        XCTAssertTrue(CallSignalMatcher.matches(activeCallId: "c1", eventCallId: "c1", activePeerId: "bob", eventPeerId: "bob"))
    }

    func testRejectsWrongPeer() {
        XCTAssertFalse(CallSignalMatcher.matches(activeCallId: "c1", eventCallId: "c1", activePeerId: "bob", eventPeerId: "mallory"))
    }

    func testAcceptsEmptyEventCallIdForCompatibility() {
        XCTAssertTrue(CallSignalMatcher.matches(activeCallId: "c1", eventCallId: "", activePeerId: "bob", eventPeerId: "bob"))
    }

    func testEmptyActiveCallIdDoesNotAcceptNonEmptyEventCallId() {
        XCTAssertFalse(CallSignalMatcher.matches(activeCallId: "", eventCallId: "c1", activePeerId: "bob", eventPeerId: "bob"))
    }
}
