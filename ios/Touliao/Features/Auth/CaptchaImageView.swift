import SwiftUI
import WebKit

/// 渲染后端下发的图形验证码（data:image/svg+xml;base64,... 字符串）。
/// SwiftUI/UIKit 没有原生 SVG 解码能力，项目现有图片库 Kingfisher 也只处理位图——
/// 用系统自带的 WKWebView 加载一个内嵌 <img> 是不引入任何新第三方依赖的最小实现。
struct CaptchaImageView: UIViewRepresentable {
    let svgDataUrl: String

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard !svgDataUrl.isEmpty else { return }
        let html = """
        <html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="margin:0;padding:0;display:flex;align-items:center;justify-content:center;height:100vh;background:transparent;">
        <img src="\(svgDataUrl)" style="width:100%;height:100%;object-fit:contain;" />
        </body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }
}
