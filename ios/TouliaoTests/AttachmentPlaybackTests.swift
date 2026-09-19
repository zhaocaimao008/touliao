import XCTest
import AVFoundation
@testable import Touliao

@MainActor
final class AttachmentPlaybackTests: XCTestCase {
    func testUpdatingPreviewForTheSameSourcePreservesPlayerAndItem() throws {
        let playback = AttachmentPlayback()
        let source = FileManager.default.temporaryDirectory.appendingPathComponent("preview.mov").absoluteString
        playback.load(source)
        let player = playback.player
        let item = try XCTUnwrap(player.currentItem)
        // A download / toast update must not replace the item and reset its playhead.
        playback.load(source)
        XCTAssertTrue(playback.player === player)
        XCTAssertTrue(playback.player.currentItem === item)
        playback.load(source + "?next=1")
        XCTAssertFalse(playback.player.currentItem === item)
        player.pause()
    }
}
