import XCTest
@testable import Touliao

final class OtherDeviceCallStateTests: XCTestCase {
    func testOutgoingCallBlocksOnlyItsAccountUntilMatchingEnd() {
        var state = OtherDeviceCallState()
        XCTAssertFalse(state.isBusy(identityEpoch: 1))
        state.began(callId: "call-1", identityEpoch: 1)
        XCTAssertTrue(state.isBusy(identityEpoch: 1))
        XCTAssertFalse(state.isBusy(identityEpoch: 2))
        state.ended(callId: "old-call")
        XCTAssertTrue(state.isBusy(identityEpoch: 1))
        state.ended(callId: "call-1")
        XCTAssertFalse(state.isBusy(identityEpoch: 1))
    }
}
