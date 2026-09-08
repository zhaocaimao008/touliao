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
        XCTAssertTrue(canResume("c1", "c1", 7, 7))
        XCTAssertFalse(canResume("c1", "c1", nil, 7))
        XCTAssertFalse(canResume("c1", "", 7, 7))
        XCTAssertFalse(canResume("c1", "old", 7, 7))
        XCTAssertFalse(canResume("", "", 7, 7))
    }

    func testReconnectResumeRejectsIdentityChangeAndABA() {
        var token: String? = "fixture-A"
        let credentials = KeychainStore(readToken: { token }, writeToken: { token = $0 })
        let participation = credentials.snapshot()
        credentials.beginIdentityChange()
        credentials.token = "fixture-B"
        let accountB = credentials.snapshot()
        credentials.beginIdentityChange()
        credentials.token = "fixture-A"
        let accountAAgain = credentials.snapshot()

        XCTAssertFalse(canResume("c1", "c1", participation.identityEpoch, accountB.identityEpoch))
        XCTAssertFalse(canResume("c1", "c1", participation.identityEpoch, accountAAgain.identityEpoch))
    }

    func testReconnectResumeAllowsCredentialRevisionWithinIdentity() {
        var token: String? = "fixture-A"
        let credentials = KeychainStore(readToken: { token }, writeToken: { token = $0 })
        let participation = credentials.snapshot()
        credentials.token = "fixture-refreshed-A"
        let refreshed = credentials.snapshot()

        XCTAssertNotEqual(participation.revision, refreshed.revision)
        XCTAssertEqual(participation.identityEpoch, refreshed.identityEpoch)
        XCTAssertTrue(canResume("c1", "c1", participation.identityEpoch, refreshed.identityEpoch))
    }

    private func canResume(
        _ activeCallId: String,
        _ participatingCallId: String,
        _ participatingIdentityEpoch: UInt64?,
        _ currentIdentityEpoch: UInt64
    ) -> Bool {
        CallSignalMatcher.canResume(
            activeCallId: activeCallId,
            participatingCallId: participatingCallId,
            participatingIdentityEpoch: participatingIdentityEpoch,
            currentIdentityEpoch: currentIdentityEpoch
        )
    }
}
