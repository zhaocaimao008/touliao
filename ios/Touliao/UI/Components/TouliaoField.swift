import SwiftUI

private struct TouliaoFieldErrorKey: EnvironmentKey { static let defaultValue: String? = nil }
extension EnvironmentValues {
    var touliaoFieldError: String? {
        get { self[TouliaoFieldErrorKey.self] }
        set { self[TouliaoFieldErrorKey.self] = newValue }
    }
}

/// Keep the field name visible after entering text, as on the current clients.
struct TouliaoField<Content: View>: View {
    let title: String
    var error: String? = nil
    var hint: String? = nil
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TouliaoMetrics.space2) {
            Text(title).touliaoText(.secondary, weight: .medium).foregroundColor(.vxinText)
            content().environment(\.touliaoFieldError, error)
                .accessibilityHint(error ?? hint ?? "")
            if let text = error ?? hint {
                Text(text).touliaoText(.caption)
                    .foregroundColor(error == nil ? .vxinTextSecondary : .vxinError)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
