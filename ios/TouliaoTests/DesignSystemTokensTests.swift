import XCTest
import SwiftUI
import UIKit
@testable import Touliao

final class DesignSystemTokensTests: XCTestCase {
    func testFeedbackDurationBounds() {
        // VoiceOver is separately covered by the manual hardware checklist.
        if !UIAccessibility.isVoiceOverRunning {
            XCTAssertEqual(touliaoFeedbackDuration("保存成功", kind: .success), 4)
            XCTAssertEqual(touliaoFeedbackDuration("上传失败", kind: .error), 4.5)
        }
        XCTAssertEqual(touliaoFeedbackDuration(String(repeating: "文", count: 1000), kind: .error), 12)
    }
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
