import SwiftUI

// MARK: - 极光空状态 hero（v3）
// 与 Web 端 EmptyState(illustration="chat") 同构：深空插画卡片 + 光带 + 星 +
// 聊天气泡剪影 + 衬线标题 + 单个品牌 CTA。次级空状态仍用 VxinEmptyState 简化版。

/// 主空状态 hero：会话列表为空时使用。
struct AuroraEmptyHero: View {
    var title: String
    var subtitle: String?
    var actionTitle: String
    var action: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                Spacer(minLength: 48)
                AuroraHeroArtwork()
                    .frame(width: 220)
                    .accessibilityHidden(true)
                VStack(spacing: 8) {
                    Text(title)
                        .auroraDisplay(size: 22, weight: .bold)
                        .multilineTextAlignment(.center)
                    if let subtitle {
                        Text(subtitle)
                            .font(.subheadline)
                            .foregroundStyle(Color.vxinTextSecondary)
                            .multilineTextAlignment(.center)
                    }
                }
                Button(action: action) {
                    Text(actionTitle)
                        .font(.headline)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 36)
                        .padding(.vertical, 13)
                        .background(
                            LinearGradient(
                                colors: [Color.vxinBrand, TouliaoDesign.primaryHover],
                                startPoint: .topLeading, endPoint: .bottomTrailing
                            )
                        )
                        .clipShape(Capsule())
                }
                .accessibilityLabel(actionTitle)
                .accessibilityHint(Text("前往通讯录选择联系人开始聊天"))
                Spacer(minLength: 48)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 32)
        }
    }
}

// MARK: - 极光插画（与 Web EmptyIllustration kind="chat" 同构，viewBox 200×140）

private struct AuroraHeroArtwork: View {
    var body: some View {
        GeometryReader { geo in
            let s = geo.size.width / 200
            ZStack {
                // 深空底
                RoundedRectangle(cornerRadius: 20 * s, style: .continuous)
                    .fill(Color.auroraAbyss)
                // 极光辉光
                Ellipse()
                    .fill(
                        RadialGradient(
                            colors: [Color.vxinBrand.opacity(0.25), .clear],
                            center: .center, startRadius: 0, endRadius: 100 * s
                        )
                    )
                    .frame(width: 180 * s, height: 128 * s)
                // 光带 1：M20 70 Q60 30 100 62 T180 52（T 反射控制点为 (140,94)）
                Path { p in
                    p.move(to: CGPoint(x: 20 * s, y: 70 * s))
                    p.addQuadCurve(to: CGPoint(x: 100 * s, y: 62 * s),
                                   control: CGPoint(x: 60 * s, y: 30 * s))
                    p.addQuadCurve(to: CGPoint(x: 180 * s, y: 52 * s),
                                   control: CGPoint(x: 140 * s, y: 94 * s))
                }
                .stroke(
                    LinearGradient(
                        colors: [.clear, Color.vxinBrand.opacity(0.55),
                                 Color.vxinAuroraTeal.opacity(0.35), .clear],
                        startPoint: .leading, endPoint: .trailing
                    ),
                    style: StrokeStyle(lineWidth: 10 * s, lineCap: .round)
                )
                .opacity(0.9)
                // 光带 2：M20 92 Q70 58 110 84 T180 74（T 反射控制点为 (150,110)）
                Path { p in
                    p.move(to: CGPoint(x: 20 * s, y: 92 * s))
                    p.addQuadCurve(to: CGPoint(x: 110 * s, y: 84 * s),
                                   control: CGPoint(x: 70 * s, y: 58 * s))
                    p.addQuadCurve(to: CGPoint(x: 180 * s, y: 74 * s),
                                   control: CGPoint(x: 150 * s, y: 110 * s))
                }
                .stroke(
                    LinearGradient(
                        colors: [.clear, Color.vxinAuroraTeal.opacity(0.4),
                                 Color.vxinBrand.opacity(0.4), .clear],
                        startPoint: .leading, endPoint: .trailing
                    ),
                    style: StrokeStyle(lineWidth: 7 * s, lineCap: .round)
                )
                .opacity(0.8)
                // 星
                Group {
                    Circle().fill(.white.opacity(0.9)).frame(width: 3.2 * s, height: 3.2 * s)
                        .position(x: 52 * s, y: 34 * s)
                    Circle().fill(.white.opacity(0.6)).frame(width: 2.4 * s, height: 2.4 * s)
                        .position(x: 96 * s, y: 24 * s)
                    Circle().fill(Color.vxinAuroraTeal.opacity(0.8)).frame(width: 4 * s, height: 4 * s)
                        .position(x: 140 * s, y: 38 * s)
                    Circle().fill(.white.opacity(0.7)).frame(width: 2.8 * s, height: 2.8 * s)
                        .position(x: 164 * s, y: 96 * s)
                    Circle().fill(.white.opacity(0.5)).frame(width: 2.4 * s, height: 2.4 * s)
                        .position(x: 38 * s, y: 108 * s)
                    Circle().fill(.white.opacity(0.8)).frame(width: 3.2 * s, height: 3.2 * s)
                        .position(x: 120 * s, y: 108 * s)
                }
                // 聊天气泡剪影
                RoundedRectangle(cornerRadius: 12 * s, style: .continuous)
                    .fill(.white.opacity(0.14))
                    .frame(width: 56 * s, height: 36 * s)
                    .position(x: 100 * s, y: 70 * s)
                Path { p in
                    p.move(to: CGPoint(x: 84 * s, y: 88 * s))
                    p.addLine(to: CGPoint(x: 80 * s, y: 98 * s))
                    p.addLine(to: CGPoint(x: 96 * s, y: 88 * s))
                    p.closeSubpath()
                }
                .fill(.white.opacity(0.14))
                Group {
                    Circle().fill(.white.opacity(0.85)).frame(width: 4.8 * s, height: 4.8 * s)
                        .position(x: 90 * s, y: 70 * s)
                    Circle().fill(.white.opacity(0.85)).frame(width: 4.8 * s, height: 4.8 * s)
                        .position(x: 100 * s, y: 70 * s)
                    Circle().fill(.white.opacity(0.85)).frame(width: 4.8 * s, height: 4.8 * s)
                        .position(x: 110 * s, y: 70 * s)
                }
            }
        }
        .aspectRatio(200 / 140, contentMode: .fit)
    }
}
