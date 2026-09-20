import XCTest
@testable import Touliao
@MainActor
final class SocialReadGuardTests: XCTestCase {
    func testInvalidationReorderingReconnectAndIdentityABA() throws {
        var epoch: UInt64 = 1; var revision: UInt64 = 0
        let guarder = SocialReadGuard(identity: { epoch }, revision: { revision })
        let old = try XCTUnwrap(guarder.begin())
        XCTAssertTrue(guarder.current(old))
        revision += 1
        XCTAssertFalse(guarder.current(old))
        let one = try XCTUnwrap(guarder.begin()); let two = try XCTUnwrap(guarder.begin())
        XCTAssertFalse(guarder.current(one)); XCTAssertTrue(guarder.current(two))
        epoch += 2
        XCTAssertFalse(guarder.current(two)); XCTAssertNil(guarder.begin())
    }
}
