import XCTest
import SwiftUI
import UIKit
@testable import Touliao

final class DesignAccessibilityTests: XCTestCase {
    func testTextPreferencesDoNotSuppressLargerSystemText() {
        XCTAssertEqual(touliaoTextSize(system: .large, preference: .small), .small)
        XCTAssertEqual(touliaoTextSize(system: .accessibility3, preference: .large), .accessibility3)
        XCTAssertEqual(touliaoTextSize(system: .xLarge, preference: .xxxLarge), .xxxLarge)
    }
    func testOrdinaryTextContrastInBothThemes() {
        for style in [UIUserInterfaceStyle.light, .dark] {
            let traits = UITraitCollection(userInterfaceStyle: style)
            let pairs: [(Color, Color)] = [
                (TouliaoDesign.text, TouliaoDesign.surface),
                (TouliaoDesign.readableMuted, TouliaoDesign.surface),
                (TouliaoDesign.readableMuted, TouliaoDesign.primarySoft),
                (TouliaoDesign.primaryForeground, TouliaoDesign.primary),
                (TouliaoDesign.messageOutgoingText, TouliaoDesign.messageOutgoing),
                (TouliaoDesign.readableDanger, TouliaoDesign.dangerSoft)
            ]
            for (foreground, background) in pairs {
                let a = luminance(UIColor(foreground).resolvedColor(with: traits))
                let b = luminance(UIColor(background).resolvedColor(with: traits))
                XCTAssertGreaterThanOrEqual((max(a,b) + 0.05) / (min(a,b) + 0.05), 4.5)
            }
        }
    }
    private func luminance(_ color: UIColor) -> Double {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        func linear(_ c: CGFloat) -> Double { c <= 0.04045 ? Double(c / 12.92) : pow(Double((c + 0.055) / 1.055), 2.4) }
        return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
    }
}
