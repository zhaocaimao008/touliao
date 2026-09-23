import SwiftUI

struct TouliaoBadge: View {
    let count: Int

    var body: some View {
        if count > 0 {
            Text(count > 99 ? "99+" : "\(count)")
                .touliaoText(.caption, weight: .medium)
                .monospacedDigit().fixedSize()
                .foregroundColor(.vxinOnPrimary)
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(Color.vxinError).clipShape(Capsule())
                .accessibilityLabel("\(count) 条未读")
        }
    }
}
