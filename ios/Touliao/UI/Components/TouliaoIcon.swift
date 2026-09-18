import SwiftUI

/// Design-kit vectors use template rendering; unsupported business symbols keep SF Symbols.
struct TouliaoIcon: View {
    let systemName: String
    var size: CGFloat = 20
    var body: some View {
        Self.image(systemName).resizable().scaledToFit().frame(width: size, height: size)
            .accessibilityHidden(true)
    }
    static func image(_ name: String) -> Image {
        if let asset = symbols[name] { return Image("tl-" + asset).renderingMode(.template) }
        return Image(systemName: name).renderingMode(.template)
    }
    static let symbols: [String: String] = [
        "bubble.left.and.bubble.right.fill": "message-circle", "bubble.left.and.bubble.right": "message-circle",
        "bubble.left.fill": "message-circle", "bubble.left": "message-circle", "text.bubble": "message-square",
        "person.2.fill": "contact-round", "person.2": "contact-round", "person.3": "users", "person.3.fill": "users",
        "person.crop.circle.fill": "user-round", "person.crop.circle": "user-round", "person.fill": "user-round",
        "person.badge.plus": "user-round-plus", "person.badge.plus.fill": "user-round-plus",
        "magnifyingglass": "search", "plus": "plus", 
        "xmark": "x", "checkmark": "check",
        "checkmark.circle.fill": "circle-check", "chevron.left": "chevron-left", "chevron.right": "chevron-right",
        "chevron.down": "chevron-down", "ellipsis": "ellipsis",
        "ellipsis.circle": "ellipsis", "qrcode": "qr-code", "qrcode.viewfinder": "scan-line",
        "phone": "phone", "phone.fill": "phone", "phone.arrow.up.right": "phone-outgoing",
        "phone.arrow.down.left": "phone-incoming", "phone.down.fill": "phone-off",
        "video.fill": "video", "video": "video", 
        "camera.fill": "camera", "camera": "camera", "camera.viewfinder": "scan-line",
        "photo": "image", "photo.fill": "image", "photo.on.rectangle": "images",
        "mic.fill": "mic", "mic": "mic", 
        "speaker.wave.2.fill": "volume-2", 
        "arrow.down": "arrow-down", 
        "arrow.clockwise": "refresh-cw", "arrow.triangle.2.circlepath": "refresh-cw",
        "paperplane.fill": "send", "paperplane": "send", "paperclip": "paperclip",
        "face.smiling": "smile", "at": "at-sign", "at.circle": "at-sign",
        "doc.fill": "file-text", "doc": "file-text", "doc.on.doc": "copy", "folder": "folder", "folder.fill": "folder",
        "square.and.arrow.up": "share-2", "square.and.arrow.down": "download",
        "trash": "trash-2", "trash.fill": "trash-2",
        "bell": "bell", "bell.fill": "bell", "bell.badge": "bell",
        "gearshape": "settings", "gearshape.fill": "settings", "paintpalette": "sun",
        "sun.max": "sun", "moon": "moon", "moon.fill": "moon", "lock.fill": "lock-keyhole",
        "lock": "lock-keyhole", "lock.shield": "shield", "shield": "shield", "eye": "eye", "eye.slash": "eye-off",
        "iphone": "smartphone", "desktopcomputer": "monitor", "laptopcomputer": "laptop",
        "clock": "clock", "clock.fill": "clock", "exclamationmark.circle.fill": "circle-alert",
        "exclamationmark.triangle": "triangle-alert", "exclamationmark.triangle.fill": "triangle-alert",
        "info.circle": "info", "info.circle.fill": "info", "star": "star", "star.fill": "star",
        "heart": "heart", "heart.fill": "heart", "bookmark": "bookmark", "bookmark.fill": "bookmark",
        "tag": "tag", "tag.fill": "tag", "play.fill": "play", 
        "pause.fill": "pause", "wifi.slash": "wifi-off",
    ]
}

extension Label where Title == Text, Icon == Image {
    init(_ title: String, touliaoSystemImage: String) {
        self.init { Text(title) } icon: { TouliaoIcon.image(touliaoSystemImage) }
    }
}
