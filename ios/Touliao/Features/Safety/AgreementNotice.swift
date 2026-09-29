import SwiftUI

/// 登录/注册按钮下方的协议提示。App Store 1.2（用户生成内容）要求用户同意含零容忍条款的
/// 用户协议；两份文档直接打开官网页面，与 App Store Connect 的隐私政策网址为同一份。
struct AgreementNotice: View {
    let action: String
    var body: some View {
        Text(attributed)
            .touliaoText(.secondary)
            .foregroundColor(.vxinTextSecondary)
            .tint(.vxinBrand)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .accessibilityIdentifier("agreement-notice")
    }
    private var attributed: AttributedString {
        let markdown = "\(action)即表示同意[《用户协议》](https://touliao.cc/terms.html)和[《隐私政策》](https://touliao.cc/privacy.html)"
        return (try? AttributedString(markdown: markdown)) ?? AttributedString("\(action)即表示同意《用户协议》和《隐私政策》")
    }
}
