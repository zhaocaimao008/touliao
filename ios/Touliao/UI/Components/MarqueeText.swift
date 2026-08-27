import SwiftUI

/// 单行自动横向滚动文本（跑马灯/轮播）。文本超出容器宽度时来回滚动；否则静止居左。
/// 用于群公告置顶条，与 Android basicMarquee 对齐。
struct MarqueeText: View {
    let text: String
    var font: Font = .footnote
    var color: Color = .primary

    @State private var textWidth: CGFloat = 0
    @State private var containerWidth: CGFloat = 0
    @State private var animate = false

    private var needsScroll: Bool { textWidth > containerWidth && containerWidth > 0 }
    private var travel: CGFloat { max(0, textWidth - containerWidth) + 24 }

    var body: some View {
        GeometryReader { geo in
            Text(text)
                .font(font)
                .foregroundColor(color)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
                .background(
                    GeometryReader { tp in
                        Color.clear.preference(key: MarqueeWidthKey.self, value: tp.size.width)
                    }
                )
                .offset(x: needsScroll && animate ? -travel : 0)
                .animation(
                    needsScroll
                        ? .linear(duration: Double(travel) / 30.0).repeatForever(autoreverses: true)
                        : .default,
                    value: animate
                )
                .onAppear {
                    containerWidth = geo.size.width
                    // 下一帧再启动，确保宽度已测量
                    DispatchQueue.main.async { animate = true }
                }
                .onChange(of: geo.size.width) { containerWidth = $0 }
        }
        .onPreferenceChange(MarqueeWidthKey.self) { textWidth = $0 }
        .frame(height: 18)
        .clipped()
    }
}

private struct MarqueeWidthKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
