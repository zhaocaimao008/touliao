import XCTest
import UIKit
@testable import Touliao

final class TouliaoIconTests: XCTestCase {
    func testEverySemanticIconLoadsFromAssetCatalog() {
        for (name, asset) in TouliaoIconRegistry.assets {
            let image = UIImage(named: "tl-" + asset, in: Bundle.main, compatibleWith: nil)
            XCTAssertNotNil(image, "Missing vector asset for \(name)")
            XCTAssertGreaterThan(image?.size.width ?? 0, 0)
        }
    }
    func testAudioRoutesAndAttachmentsHaveDistinctGlyphs() {
        let icons = TouliaoIconRegistry.assets
        XCTAssertEqual(Set([icons["bluetooth"], icons["speaker"], icons["earpiece"]]).count, 3)
        XCTAssertEqual(icons["file"], "paperclip")
        XCTAssertEqual(icons["fileContent"], "file-text")
        XCTAssertNotEqual(icons["mute"], icons["speakerOff"])
    }
}
