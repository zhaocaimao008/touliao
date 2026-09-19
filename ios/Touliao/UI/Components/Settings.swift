import SwiftUI

/// Section card wrapper (rounded card, very light border)
struct TouliaoSettingSection<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(spacing: 0) { content }
            .background(Color.vxinSurface)
            .clipShape(RoundedRectangle(cornerRadius: TouliaoMetrics.radiusCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TouliaoMetrics.radiusCard, style: .continuous)
                    .stroke(Color.vxinBorder, lineWidth: 0.5)
            )
    }
}

/// Section header label above a card
struct TouliaoSectionHeader: View {
    let text: String
    var body: some View {
        Text(text)
            .touliaoText(.secondary, weight: .medium)
            .foregroundColor(Color.vxinTextSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, TouliaoMetrics.space5)
            .padding(.top, TouliaoMetrics.space5)
            .padding(.bottom, TouliaoMetrics.space2)
    }
}

/// Standard settings row: icon | title | [trailing] | chevron
struct TouliaoSettingRow: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let icon: String
    let title: String
    var trailing: String? = nil
    var showsSpinner = false
    var iconColor: Color = Color.vxinText
    var body: some View {
        HStack(spacing: TouliaoMetrics.space3) {
            TouliaoIcon(icon)
                .touliaoFont(CGFloat(22) - 2, weight: .light)
                .foregroundColor(iconColor)
                .frame(width: TouliaoMetrics.space6, alignment: .center)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).touliaoText(.body).foregroundColor(Color.vxinText)
                    .fixedSize(horizontal: false, vertical: true)
                if typeSize.isAccessibilitySize, let trailing, !showsSpinner {
                    Text(trailing).touliaoText(.secondary).foregroundColor(Color.vxinTextSecondary)
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
            if showsSpinner {
                ProgressView()
            } else if !typeSize.isAccessibilitySize, let trailing {
                Text(trailing).touliaoText(.secondary).foregroundColor(Color.vxinTextSecondary).lineLimit(1)
            }
            TouliaoIcon("disclosure", size: .xs)
                .foregroundColor(Color.vxinTextSecondary.opacity(0.6))
        }
        .padding(.horizontal, TouliaoMetrics.space4).padding(.vertical, 8)
        .frame(minHeight: TouliaoMetrics.settingHeight)
        .background(Color.vxinSurface)
        .contentShape(Rectangle())
    }
}

struct TouliaoSettingDivider: View {
    var body: some View {
        Divider()
            .background(Color.vxinBorder)
            .padding(.leading, TouliaoMetrics.space4 + TouliaoMetrics.space6 + TouliaoMetrics.space3)
    }
}

