import SwiftUI

struct RegisterView: View {
    @EnvironmentObject private var session: SessionStore
    @StateObject private var vm = AuthViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Spacer()

            Text("注册账号")
                .font(.title.bold())
                .foregroundColor(.vxinGreen)
                .padding(.bottom, 16)

            TextField("昵称", text: $vm.username)
                .textFieldStyle(.roundedBorder)
            TextField("手机号", text: $vm.phone)
                .keyboardType(.phonePad)
                .textFieldStyle(.roundedBorder)
            SecureField("密码（至少6位）", text: $vm.password)
                .textFieldStyle(.roundedBorder)

            if let error = vm.error {
                Text(error)
                    .font(.footnote)
                    .foregroundColor(.vxinError)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button(action: vm.register) {
                ZStack {
                    if vm.loading { ProgressView().tint(.white) }
                    else { Text("注册并登录").bold() }
                }
                .frame(maxWidth: .infinity, minHeight: 48)
            }
            .background(vm.canRegister ? Color.vxinGreen : Color.vxinGreen.opacity(0.4))
            .foregroundColor(.white)
            .cornerRadius(8)
            .disabled(!vm.canRegister)
            .padding(.top, 8)

            Spacer()
        }
        .padding(.horizontal, 32)
        .navigationTitle("注册")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: vm.authedUser) { user in
            if let user { session.onAuthenticated(user) }
        }
    }
}
