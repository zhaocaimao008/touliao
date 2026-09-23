import SwiftUI

/// Application glyphs always come from the shared registry. Platform system UI owns its own icons.
struct TouliaoIcon: View {
    let name: String
    var size: IconSize = .sm
    init(_ name: String, size: IconSize = .sm) { self.name = name; self.size = size }
    var body: some View {
        Self.image(name).resizable().scaledToFit()
            .frame(width: size.rawValue, height: size.rawValue)
            .accessibilityHidden(true)
    }
    static func image(_ name: String) -> Image {
        guard let asset = TouliaoIconRegistry.assets[name] else {
            assertionFailure("Unregistered Touliao icon: \(name)")
            return Image("tl-circle-help").renderingMode(.template)
        }
        return Image("tl-" + asset).renderingMode(.template)
    }
    static func messageType(_ type: String) -> String {
        ["text": "text", "image": "image", "sticker": "image", "voice": "voice", "video": "video",
         "file": "fileContent", "contact_card": "contact", "contact": "contact", "red_packet": "redPacket",
         "transfer": "transfer", "merged": "mergedMessages", "call": "phone"][type] ?? "allTypes"
    }
}

struct TouliaoIconButton: View {
    let name: String
    let label: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            TouliaoIcon(name, size: .md).frame(width: IconTouchTarget.ios, height: IconTouchTarget.ios)
                .contentShape(Rectangle())
        }.accessibilityLabel(label)
    }
}

extension Label where Title == Text, Icon == Image {
    init(_ title: String, touliaoIcon: String) {
        self.init { Text(title) } icon: { TouliaoIcon.image(touliaoIcon) }
    }
}
