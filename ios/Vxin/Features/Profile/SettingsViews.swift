import SwiftUI

// MARK: - 外观（纯本地设置，AppStorage 持久化）

/// 外观主题：跟随系统 / 日间 / 夜间。原始值持久化到 UserDefaults。
enum AppTheme: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var label: String {
        switch self {
        case .system: return "跟随系统"
        case .light: return "日间模式"
        case .dark: return "夜间模式"
        }
    }
    /// 映射到 SwiftUI 的 colorScheme；system 返回 nil（交给系统）。
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

/// 字号档位：映射到 DynamicTypeSize。
enum AppFontScale: String, CaseIterable, Identifiable {
    case small, standard, large, xlarge
    var id: String { rawValue }
    var label: String {
        switch self {
        case .small: return "小"
        case .standard: return "标准"
        case .large: return "大"
        case .xlarge: return "特大"
        }
    }
    var dynamicTypeSize: DynamicTypeSize {
        switch self {
        case .small: return .small
        case .standard: return .large          // 系统默认档
        case .large: return .xLarge
        case .xlarge: return .xxxLarge
        }
    }
}

/// 外观本地设置的单一读取点，供 RootView 应用、AppearanceSettingsView 修改。
enum AppearanceStore {
    static let themeKey = "vxin.appearance.theme"
    static let fontKey = "vxin.appearance.fontScale"

    static var theme: AppTheme {
        AppTheme(rawValue: UserDefaults.standard.string(forKey: themeKey) ?? "") ?? .system
    }
    static var fontScale: AppFontScale {
        AppFontScale(rawValue: UserDefaults.standard.string(forKey: fontKey) ?? "") ?? .standard
    }
}

/// 外观设置页：主题 + 字号，纯本地即时生效。
struct AppearanceSettingsView: View {
    @AppStorage(AppearanceStore.themeKey) private var themeRaw = AppTheme.system.rawValue
    @AppStorage(AppearanceStore.fontKey) private var fontRaw = AppFontScale.standard.rawValue

    var body: some View {
        Form {
            Section("主题") {
                Picker("主题", selection: $themeRaw) {
                    ForEach(AppTheme.allCases) { t in Text(t.label).tag(t.rawValue) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
            Section("字体大小") {
                Picker("字体大小", selection: $fontRaw) {
                    ForEach(AppFontScale.allCases) { f in Text(f.label).tag(f.rawValue) }
                }
                .pickerStyle(.segmented)
            }
        }
        .navigationTitle("外观")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - 通知（后端 user_settings：messageNotify/sound/vibrate/detailPreview）

@MainActor
final class NotificationSettingsViewModel: ObservableObject {
    @Published var messageNotify = true
    @Published var sound = true
    @Published var vibrate = false
    @Published var detailPreview = true
    @Published var loading = true
    @Published var error: String?

    private let repo = ProfileRepository.shared

    func load() async {
        loading = true; error = nil
        if let s = try? await repo.notificationSettings() {
            messageNotify = s.messageNotify
            sound = s.sound
            vibrate = s.vibrate
            detailPreview = s.detailPreview
        } else {
            error = "加载通知设置失败"
        }
        loading = false
    }

    func update(messageNotify: Bool? = nil, sound: Bool? = nil, vibrate: Bool? = nil, detailPreview: Bool? = nil) {
        Task {
            do {
                try await repo.updateNotificationSettings(
                    messageNotify: messageNotify, sound: sound, vibrate: vibrate, detailPreview: detailPreview
                )
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "保存失败"
                await load()   // 保存失败回滚到服务端真值
            }
        }
    }
}

struct NotificationSettingsView: View {
    @StateObject private var vm = NotificationSettingsViewModel()

    var body: some View {
        Form {
            Section {
                Toggle("接收消息通知", isOn: Binding(
                    get: { vm.messageNotify },
                    set: { vm.messageNotify = $0; vm.update(messageNotify: $0) }
                ))
                Toggle("通知声音", isOn: Binding(
                    get: { vm.sound }, set: { vm.sound = $0; vm.update(sound: $0) }
                ))
                Toggle("震动", isOn: Binding(
                    get: { vm.vibrate }, set: { vm.vibrate = $0; vm.update(vibrate: $0) }
                ))
                Toggle("通知显示消息详情", isOn: Binding(
                    get: { vm.detailPreview }, set: { vm.detailPreview = $0; vm.update(detailPreview: $0) }
                ))
            }, footer: {
                Text("关闭「消息详情」后，通知只提示有新消息，不显示内容。")
            })
            Section(content: {
                NavigationLink("勿扰模式") { QuietSettingsView() }
            }, footer: {
                Text("开启后在指定时段内仅抑制推送，聊天正常收消息。")
            })
        }
        .navigationTitle("通知")
        .navigationBarTitleDisplayMode(.inline)
        .overlay { if vm.loading { ProgressView() } }
        .toast($vm.error)
        .task { await vm.load() }
    }
}

// MARK: - 换绑手机号（新手机号 + 当前登录密码验证）

@MainActor
final class ChangePhoneViewModel: ObservableObject {
    @Published var newPhone = ""
    @Published var password = ""
    @Published var changing = false
    @Published var message: String?

    private let repo = ProfileRepository.shared

    /// 表单有效：手机号≥6位、密码非空。
    var valid: Bool {
        newPhone.trimmingCharacters(in: .whitespaces).count >= 6 &&
        !password.isEmpty
    }

    /// 换绑：调 PUT /api/users/me/phone；成功后回调更新本地用户信息。
    func submit(onSuccess: @escaping (String) -> Void) {
        guard !changing, valid else { return }
        changing = true; message = nil
        let phone = newPhone.trimmingCharacters(in: .whitespaces)
        Task {
            do {
                try await repo.updatePhone(newPhone: phone, password: password)
                message = "手机号已更新"
                onSuccess(phone)
            } catch {
                message = (error as? LocalizedError)?.errorDescription ?? "换绑失败"
            }
            changing = false
        }
    }
}

/// 换绑手机号页：展示当前手机号，输入新手机号 + 登录密码提交。
struct ChangePhoneView: View {
    let currentPhone: String
    var onChanged: (String) -> Void
    @StateObject private var vm = ChangePhoneViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            if !currentPhone.isEmpty {
                Section("当前手机号") {
                    Text(currentPhone).foregroundColor(.vxinTextSecondary)
                }
            }
            Section("新手机号") {
                TextField("请输入新手机号", text: $vm.newPhone)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
                    .accessibilityIdentifier("change-phone-input")
            }
            Section("验证密码") {
                SecureField("当前登录密码", text: $vm.password)
                    .textContentType(.password)
                    .accessibilityIdentifier("change-phone-password")
            }
            Section {
                Button {
                    vm.submit { newPhone in
                        onChanged(newPhone)
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { dismiss() }
                    }
                } label: {
                    if vm.changing { ProgressView() } else { Text("提交").foregroundColor(.vxinGreen) }
                }
                .disabled(!vm.valid || vm.changing)
                .accessibilityIdentifier("change-phone-submit")
            }
        }
        .navigationTitle("换绑手机号")
        .navigationBarTitleDisplayMode(.inline)
        .toast($vm.message)
    }
}

// MARK: - 勿扰时段（GET/PUT /api/users/me/settings）

@MainActor
final class QuietSettingsViewModel: ObservableObject {
    @Published var quietEnabled = false
    @Published var quietStart = Date()   // 绑定 DatePicker，仅取 HH:MM
    @Published var quietEnd = Date()
    @Published var loading = true
    @Published var saving = false
    @Published var error: String?

    private let repo = ProfileRepository.shared

    /// 将 "HH:MM" 字符串解析为当天对应的 Date（仅 HH:MM 有意义，日期取今天）
    private func parseHHMM(_ s: String) -> Date {
        let parts = s.split(separator: ":").compactMap { Int($0) }
        var comps = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        comps.hour = parts.count > 0 ? parts[0] : 0
        comps.minute = parts.count > 1 ? parts[1] : 0
        comps.second = 0
        return Calendar.current.date(from: comps) ?? Date()
    }

    /// 从 Date 提取 "HH:MM" 字符串
    private func toHHMM(_ date: Date) -> String {
        let comps = Calendar.current.dateComponents([.hour, .minute], from: date)
        let h = comps.hour ?? 0
        let m = comps.minute ?? 0
        return String(format: "%02d:%02d", h, m)
    }

    func load() async {
        loading = true; error = nil
        if let s = try? await repo.quietSettings() {
            quietEnabled = s.quietEnabled == 1
            quietStart = parseHHMM(s.quietStart)
            quietEnd = parseHHMM(s.quietEnd)
        } else {
            error = "加载勿扰设置失败"
        }
        loading = false
    }

    /// 保存全部设置（一次 PUT）
    func save() {
        guard !saving else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                try await repo.updateQuietSettings(
                    quietEnabled: quietEnabled ? 1 : 0,
                    quietStart: toHHMM(quietStart),
                    quietEnd: toHHMM(quietEnd)
                )
                error = "已保存"
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "保存失败"
                await load()   // 保存失败回滚到服务端真值
            }
        }
    }
}

/// 勿扰时段设置页：开关 + 开始/结束时间（支持跨夜 23:00-07:00）
struct QuietSettingsView: View {
    @StateObject private var vm = QuietSettingsViewModel()

    var body: some View {
        Form {
            Section(content: {
                Toggle("开启勿扰模式", isOn: Binding(
                    get: { vm.quietEnabled },
                    set: { vm.quietEnabled = $0 }
                ))
            }, footer: {
                Text("仅抑制推送通知，聊天正常收消息。支持跨夜时段（如 23:00 - 07:00）。")
            })
            if vm.quietEnabled {
                Section("勿扰时段", content: {
                    DatePicker(
                        "开始时间",
                        selection: $vm.quietStart,
                        displayedComponents: .hourAndMinute
                    )
                    .accessibilityIdentifier("quiet-start-picker")

                    DatePicker(
                        "结束时间",
                        selection: $vm.quietEnd,
                        displayedComponents: .hourAndMinute
                    )
                    .accessibilityIdentifier("quiet-end-picker")
                }, footer: {
                    Text("示例：23:00 - 07:00 表示每天晚11点至次日早7点不推送通知。")
                })
            }
            Section {
                Button {
                    vm.save()
                } label: {
                    if vm.saving {
                        ProgressView()
                    } else {
                        Text("保存").foregroundColor(.vxinGreen)
                    }
                }
                .disabled(vm.saving)
                .accessibilityIdentifier("quiet-save-btn")
            }
        }
        .navigationTitle("勿扰模式")
        .navigationBarTitleDisplayMode(.inline)
        .overlay { if vm.loading { ProgressView() } }
        .toast($vm.error)
        .task { await vm.load() }
    }
}

// MARK: - 隐私与安全（添加方式/好友权限开关 + 黑名单管理）

@MainActor
final class PrivacySettingsViewModel: ObservableObject {
    @Published var addByVxinId = true
    @Published var addByPhone = true
    @Published var requireVerify = true
    @Published var noDirectGroupInvite = false
    @Published var loading = true
    @Published var error: String?

    private let repo = ProfileRepository.shared

    func load() async {
        loading = true; error = nil
        if let s = try? await repo.privacySettings() {
            addByVxinId = s.addByVxinId
            addByPhone = s.addByPhone
            requireVerify = s.requireVerify
            noDirectGroupInvite = s.noDirectGroupInvite
        } else {
            error = "加载隐私设置失败"
        }
        loading = false
    }

    func update(addByVxinId: Bool? = nil, addByPhone: Bool? = nil,
                requireVerify: Bool? = nil, noDirectGroupInvite: Bool? = nil) {
        Task {
            do {
                try await repo.updatePrivacySettings(
                    addByVxinId: addByVxinId, addByPhone: addByPhone,
                    requireVerify: requireVerify, noDirectGroupInvite: noDirectGroupInvite
                )
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "保存失败"
                await load()   // 保存失败回滚到服务端真值
            }
        }
    }
}

struct PrivacySecurityView: View {
    @StateObject private var vm = PrivacySettingsViewModel()

    var body: some View {
        Form {
            Section("添加我的方式") {
                Toggle("通过 v信号添加", isOn: Binding(
                    get: { vm.addByVxinId }, set: { vm.addByVxinId = $0; vm.update(addByVxinId: $0) }
                ))
                Toggle("通过手机号添加", isOn: Binding(
                    get: { vm.addByPhone }, set: { vm.addByPhone = $0; vm.update(addByPhone: $0) }
                ))
            }
            Section {
                Toggle("需要验证才能添加好友", isOn: Binding(
                    get: { vm.requireVerify }, set: { vm.requireVerify = $0; vm.update(requireVerify: $0) }
                ))
                Toggle("不允许好友直接邀请我进群", isOn: Binding(
                    get: { vm.noDirectGroupInvite }, set: { vm.noDirectGroupInvite = $0; vm.update(noDirectGroupInvite: $0) }
                ))
            }, footer: {
                Text("开启后好友无法把你直接拉进群，需你扫码/点链接自行加入。")
            })
            Section("隐私") {
                NavigationLink("黑名单管理") { BlockedView() }
            }
        }
        .navigationTitle("隐私与安全")
        .navigationBarTitleDisplayMode(.inline)
        .overlay { if vm.loading { ProgressView() } }
        .toast($vm.error)
        .task { await vm.load() }
    }
}
