import XCTest
import AVFoundation
@testable import Touliao

/// 8.1.41：选中视频只导出一次 H.264 mp4，并把进度报给界面。
final class VideoTranscodeTests: XCTestCase {
    func testPresetChoiceTranscodesAtMostOnce() {
        // 已是 H.264 且 ≤ 1080p：只重封装，不重编码
        XCTAssertEqual(PickedVideoTranscoder.presetName(isH264: true, longEdge: 1920), AVAssetExportPresetPassthrough)
        XCTAssertEqual(PickedVideoTranscoder.presetName(isH264: true, longEdge: 1280), AVAssetExportPresetPassthrough)
        // 4K：不论 H.264 还是 HEVC，都只按 1080p 重编码一次
        XCTAssertEqual(PickedVideoTranscoder.presetName(isH264: true, longEdge: 3840), AVAssetExportPreset1920x1080)
        XCTAssertEqual(PickedVideoTranscoder.presetName(isH264: false, longEdge: 3840), AVAssetExportPreset1920x1080)
        // HEVC ≤ 1080p：转 H.264，不放大分辨率
        XCTAssertEqual(PickedVideoTranscoder.presetName(isH264: false, longEdge: 1920), AVAssetExportPresetHighestQuality)
    }

    func testOversizedExportFallsBackToSourceOnlyWhenSourceFits() {
        let mb: Int64 = 1024 * 1024
        let limit = PickedVideoTranscoder.maxUploadBytes
        XCTAssertEqual(limit, 200 * mb)
        // HEVC 150MB → H.264 260MB：改传原片
        XCTAssertTrue(PickedVideoTranscoder.shouldKeepSource(sourceBytes: 150 * mb, exportedBytes: 260 * mb))
        // 导出没超限：用导出结果（即使比原片大，兼容性优先）
        XCTAssertFalse(PickedVideoTranscoder.shouldKeepSource(sourceBytes: 100 * mb, exportedBytes: 180 * mb))
        // 原片本身也超限：保留导出结果，由上层统一提示超限
        XCTAssertFalse(PickedVideoTranscoder.shouldKeepSource(sourceBytes: 400 * mb, exportedBytes: 260 * mb))
        XCTAssertFalse(PickedVideoTranscoder.shouldKeepSource(sourceBytes: 0, exportedBytes: 260 * mb))
    }

    func testH264SourceIsRemuxedToMP4WithProgressAndSourceRemoved() async throws {
        let source = PickedVideoCleanup.stagingDir.appendingPathComponent("test_\(UUID().uuidString).mov")
        try await Self.writeTinyH264Movie(to: source)
        let reports = ProgressReports()
        let prepared = await PickedVideoTranscoder.prepareForUpload(
            PickedVideoFile(url: source, suggestedFileName: "test.mov")
        ) { value in reports.append(value) }
        let output = try XCTUnwrap(prepared)
        defer { PickedVideoCleanup.removeFile(output.url) }
        XCTAssertEqual(output.url.pathExtension, "mp4")
        XCTAssertTrue(output.suggestedFileName.hasSuffix(".mp4"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: source.path), "staging source must be removed once the mp4 exists")
        let tracks = try await AVURLAsset(url: output.url).loadTracks(withMediaType: .video)
        let track = try XCTUnwrap(tracks.first)
        let formats = try await track.load(.formatDescriptions)
        XCTAssertTrue(formats.contains { CMFormatDescriptionGetMediaSubType($0) == kCMVideoCodecType_H264 })
        let values = reports.values
        XCTAssertEqual(values.last, 1, "UI must see the export finish")
    }

    func testCancelledPreparationRemovesStagedFiles() async throws {
        let source = PickedVideoCleanup.stagingDir.appendingPathComponent("test_\(UUID().uuidString).mov")
        try await Self.writeTinyH264Movie(to: source)
        let task = Task { () -> PickedVideoFile? in
            withUnsafeCurrentTask { $0?.cancel() }
            return await PickedVideoTranscoder.prepareForUpload(PickedVideoFile(url: source, suggestedFileName: "x.mov")) { _ in }
        }
        let result = await task.value
        XCTAssertNil(result)
        XCTAssertFalse(FileManager.default.fileExists(atPath: source.path))
    }

    /// 生成 0.5 秒 160x120 的 H.264 .mov 作为"相册里已是 H.264 的视频"。
    private static func writeTinyH264Movie(to url: URL) async throws {
        try? FileManager.default.removeItem(at: url)
        let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 160, AVVideoHeightKey: 120,
        ])
        input.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: 160, kCVPixelBufferHeightKey as String: 120,
        ])
        writer.add(input)
        XCTAssertTrue(writer.startWriting(), "\(String(describing: writer.error))")
        writer.startSession(atSourceTime: .zero)
        for frame in 0..<15 {
            while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 5_000_000) }
            var buffer: CVPixelBuffer?
            CVPixelBufferCreate(nil, 160, 120, kCVPixelFormatType_32BGRA, nil, &buffer)
            let pixels = try XCTUnwrap(buffer)
            CVPixelBufferLockBaseAddress(pixels, [])
            if let base = CVPixelBufferGetBaseAddress(pixels) {
                memset(base, Int32(frame * 16), CVPixelBufferGetDataSize(pixels))
            }
            CVPixelBufferUnlockBaseAddress(pixels, [])
            XCTAssertTrue(adaptor.append(pixels, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: 30)))
        }
        input.markAsFinished()
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            writer.finishWriting { cont.resume() }
        }
        XCTAssertEqual(writer.status, .completed, "\(String(describing: writer.error))")
    }
}

/// 进度回调是 @MainActor 同步闭包，按调用顺序记下来供断言读取。
private final class ProgressReports: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [Double] = []
    func append(_ value: Double) { lock.lock(); stored.append(value); lock.unlock() }
    var values: [Double] { lock.lock(); defer { lock.unlock() }; return stored }
}
