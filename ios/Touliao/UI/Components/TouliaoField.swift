import SwiftUI

/// Keep the field name visible after entering text, as on the current clients.
struct TouliaoField<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).touliaoFont(14, weight: .medium).foregroundColor(.vxinText)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
