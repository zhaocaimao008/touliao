import SwiftUI
import Kingfisher

/// 头像（对齐 Android InitialAvatar）：
/// - avatarUrl 传服务端原始值（/uploads/... 相对路径）即可，内部经 MediaUrlResolver 解析并带同源鉴权头；
/// - 加载中 / 加载失败 / 无头像时显示首字母占位，不会出现空白头像。
struct InitialAvatar<S: Shape>: View {
    let name: String
    var size: CGFloat = TouliaoMetrics.avatarList
    var avatarUrl: String? = nil
    /// v4：个人头像统一圆形（四端一致）；群头像等可传圆角矩形
    var shape: S

    var body: some View {
        if let avatarUrl, !avatarUrl.isEmpty, let src = MediaUrlResolver.kfSource(raw: avatarUrl) {
            KFImage(source: src)
                .placeholder { initials }
                .cancelOnDisappear(true)
                .resizable().scaledToFill()
                .frame(width: size, height: size)
                .clipShape(shape)
        } else {
            initials
        }
    }

    private var letter: String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard let first = trimmed.first else { return "?" }
        return String(first).uppercased()
    }

    private var initials: some View {
        shape
            .fill(Color.vxinPrimarySoft)
            .frame(width: size, height: size)
            .overlay(
                Text(letter)
                    .foregroundColor(.vxinBrand)
                    .font(.system(size: size * 0.42, weight: .semibold))
            )
    }
}

extension InitialAvatar where S == Circle {
    init(name: String, size: CGFloat = TouliaoMetrics.avatarList, avatarUrl: String? = nil) {
        self.init(name: name, size: size, avatarUrl: avatarUrl, shape: Circle())
    }
}
