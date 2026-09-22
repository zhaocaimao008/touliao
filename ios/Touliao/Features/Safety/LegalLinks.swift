import SwiftUI

struct LegalLinks: View {
    @State private var document: String?
    var body: some View {
        HStack {
            Button("隐私政策") { document = LegalDocuments.privacy }
            Button("用户协议") { document = LegalDocuments.terms }
        }
        .sheet(isPresented: Binding(get: { document != nil }, set: { if !$0 { document = nil } })) {
            NavigationStack {
                ScrollView { Text(document ?? "").padding().textSelection(.enabled) }
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { document = nil } } }
            }
        }
    }
}
