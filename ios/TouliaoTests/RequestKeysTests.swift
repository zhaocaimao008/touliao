import XCTest
@testable import Touliao

final class RequestKeysTests: XCTestCase {
    func testUncertainRetryKeepsKeyAndConfirmedSuccessRetiresIt() {
        let keys = RequestKeys()
        let payload = Data("amount=20".utf8)
        let first = keys.key(scope: "server:account:1", operation: "transfer", payload: payload)
        XCTAssertEqual(first, keys.key(scope: "server:account:1", operation: "transfer", payload: payload))
        XCTAssertNotEqual(first, keys.key(scope: "server:other:2", operation: "transfer", payload: payload))
        keys.complete(scope: "server:account:1", operation: "transfer", payload: payload, key: first)
        XCTAssertNotEqual(first, keys.key(scope: "server:account:1", operation: "transfer", payload: payload))
    }
}
