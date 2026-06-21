import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var session: SessionStore
    @StateObject private var vm = AuthViewModel()
    @State private var showServerConfig = false

    var body: some View {
        VStack(spacing: 16) {
            Spacer()

            Text("v信")
                .font(.system(size: 40, weight: .bold))
                .foregroundColor(.vxinGreen)
            Text("安全、高效的企业级通讯")
                .font(.subheadline)
                .foregroundColor(.vxinTextSecondary)
                .padding(.bottom, 24)

            TextField("手机号", text: $vm.phone)
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
                .textFieldStyle(.roundedBorder)

            SecureField("密码", text: $vm.password)
                .textContentType(.password)
                .textFieldStyle(.roundedBorder)

            if let error = vm.error {
                Text(error)
                    .font(.footnote)
                    .foregroundColor(.vxinError)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button(action: vm.login) {
                ZStack {
                    if vm.loading { ProgressView().tint(.white) }
                    else { Text("登录").bold() }
                }
                .frame(maxWidth: .infinity, minHeight: 48)
            }
            .background(vm.canLogin ? Color.vxinGreen : Color.vxinGreen.opacity(0.4))
            .foregroundColor(.white)
            .cornerRadius(8)
            .disabled(!vm.canLogin)
            .padding(.top, 8)

            NavigationLink("注册账号") { RegisterView() }
                .foregroundColor(.vxinGreen)

            Button(showServerConfig ? "收起" : "切换服务器") { showServerConfig.toggle() }
                .font(.caption)
                .foregroundColor(.vxinTextSecondary)

            if showServerConfig {
                TextField("服务器地址", text: $vm.serverURL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .textFieldStyle(.roundedBorder)
                Button("保存") { vm.saveServerURL(); showServerConfig = false }
                    .foregroundColor(.vxinGreen)
            }

            Spacer()
        }
        .padding(.horizontal, 32)
        .onChange(of: vm.authedUser) { user in
            if let user { session.onAuthenticated(user) }
        }
    }
}
