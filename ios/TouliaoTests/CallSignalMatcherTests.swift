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

    func testServerRestartWithoutPeerMatchesOnlyTheExactActiveCall() {
        XCTAssertTrue(CallSignalMatcher.matchesEnd(activeCallId: "c1", eventCallId: "c1", activePeerId: "bob", eventPeerId: "", reason: "server_restarted"))
        XCTAssertFalse(CallSignalMatcher.matchesEnd(activeCallId: "c1", eventCallId: "old", activePeerId: "bob", eventPeerId: "", reason: "server_restarted"))
        XCTAssertFalse(CallSignalMatcher.matchesEnd(activeCallId: "c1", eventCallId: "", activePeerId: "bob", eventPeerId: "", reason: "server_restarted"))
        XCTAssertFalse(CallSignalMatcher.matchesEnd(activeCallId: "c1", eventCallId: "c1", activePeerId: "bob", eventPeerId: "", reason: "timeout"))
    }

    func testReconnectResumeRequiresConfirmedParticipationInTheSameCall() {
        XCTAssertTrue(CallSignalMatcher.canResume(activeCallId: "c1", participatingCallId: "c1"))
        XCTAssertFalse(CallSignalMatcher.canResume(activeCallId: "c1", participatingCallId: ""))
        XCTAssertFalse(CallSignalMatcher.canResume(activeCallId: "c1", participatingCallId: "old"))
        XCTAssertFalse(CallSignalMatcher.canResume(activeCallId: "", participatingCallId: ""))
    }
}
