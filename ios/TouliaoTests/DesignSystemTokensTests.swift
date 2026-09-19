import XCTest
import SwiftUI
@testable import Touliao

final class DesignSystemTokensTests: XCTestCase {
    func testRoleAndUnitAdapters() {
        XCTAssertEqual(TouliaoMetrics.space4, 16)
        XCTAssertEqual(TouliaoMetrics.durationFast, 0.12, accuracy: 0.0001)
        XCTAssertEqual(TouliaoMetrics.touchTarget, 44)
        XCTAssertEqual(TouliaoTextRole.body.size, 16)
        XCTAssertEqual(TouliaoTextRole.title.style, .title2)
        XCTAssertEqual(TouliaoTextRole.caption.style, .caption)
        XCTAssertEqual(TouliaoMetrics.layerCall, 2000)
        XCTAssertGreaterThan(TouliaoMetrics.layerNative, TouliaoMetrics.layerCall)
    }
}
