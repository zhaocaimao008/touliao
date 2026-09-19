import SwiftUI

/// 带明/暗文切换的密码输入框(对齐微信/安卓「显示/隐藏」眼睛图标)。
/// 默认暗文，点击尾部眼睛在 SecureField / TextField 间切换。
struct PasswordField: View {
    let placeholder: String
    @Binding var text: String
    var textContentType: UITextContentType? = .password
    var accessibilityId: String? = nil

    @State private var visible = false
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 8) {
            Group {
                if visible {
                    TextField(placeholder, text: $text)
                        .textContentType(textContentType)
                } else {
                    SecureField(placeholder, text: $text)
                        .textContentType(textContentType)
                }
            }
            .focused($focused)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .modifier(AccessibilityIdIfPresent(id: accessibilityId))

            Button {
                visible.toggle()
                // 切换后保持焦点，避免键盘收起
                focused = true
            } label: {
                TouliaoIcon(systemName: visible ? "eye.slash" : "eye")
                    .foregroundColor(.vxinTextSecondary)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(visible ? "隐藏密码" : "显示密码")
        }
        .touliaoFont(16)
        .padding(.horizontal, 12)
        .padding(.vertical, 2)
        .frame(minHeight: 48)
        .background(Color.vxinSurface)
        .clipShape(RoundedRectangle(cornerRadius: VxinRadius.sm))
        .overlay(
            RoundedRectangle(cornerRadius: VxinRadius.sm)
                .stroke(Color.vxinBorder, lineWidth: 1)
        )
    }
}

/// 仅在 id 非空时附加 accessibilityIdentifier，保持与原有 UI 测试标识一致。
private struct AccessibilityIdIfPresent: ViewModifier {
    let id: String?
    func body(content: Content) -> some View {
        if let id { content.accessibilityIdentifier(id) } else { content }
    }
}
