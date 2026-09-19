import XCTest
import SwiftUI
import UIKit
@testable import Touliao

@MainActor
private final class ToastState: ObservableObject {
    @Published var message: String? = "第一条提示"
}

private struct ToastHost: View {
    @ObservedObject var state: ToastState
    var body: some View { Color.clear.toast($state.message) }
}

@MainActor
final class ToastPresentationTests: XCTestCase {
    func testReplacingAToastDoesNotLetTheCancelledTimerClearTheNewMessage() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        let state = ToastState()
        window.rootViewController = UIHostingController(rootView: ToastHost(state: state))
        window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil }
        try await Task.sleep(nanoseconds: 300_000_000)
        state.message = "第二条提示"
        try await Task.sleep(nanoseconds: 400_000_000)
        XCTAssertEqual(state.message, "第二条提示")
        try await Task.sleep(nanoseconds: 2_600_000_000)
        XCTAssertNil(state.message)
    }
}
