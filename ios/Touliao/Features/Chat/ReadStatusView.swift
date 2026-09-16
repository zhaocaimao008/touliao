import SwiftUI

// MARK: - 已读状态（F5，对齐 Web utils/readStatus.js + ReadStatusModal / Android ReadStatus.kt）

/// 可查看已读详情的消息类型（与 Web READ_DETAIL_TYPES 一致，四端口径统一）
private let readDetailTypes: Set<String> = ["text", "image", "file"]

/// 自己发送、非删除、非发送中、服务端已落库的消息才可查看已读详情
func canViewReadStatus(_ msg: Message, currentUserId: String) -> Bool {
    if msg.deleted != 0 { return false }
    if msg.localStatus != nil { return false }
    if msg.id.isEmpty { return false }
    return msg.senderId == currentUserId && readDetailTypes.contains(msg.type)
}

/// 已读成员展示项
struct ReadStatusReader: Identifiable {
    let id: String
    let name: String
    let avatar: String
}

/// 已读状态弹窗展示模型
struct ReadStatusModel {
    let isGroup: Bool
    /// 私聊：对方是否已读
    let peerRead: Bool
    /// 私聊：对方昵称（会话标题）
    let peerName: String
    /// 群聊：已读人数 / 应读人数（不含发送者）
    let readCount: Int
    let recipientCount: Int
    let readers: [ReadStatusReader]
}

/// 构建弹窗展示模型（对齐 Web createReadStatusModel / Android buildReadStatusModel）。
/// - 私聊：优先取 conversation.otherUser.id 比对已读名单；拿不到对端时退化为「有任何人已读」。
/// - 群聊：members 为群成员全量（含我也无妨，内部会排除发送者）。
func buildReadStatusModel(isGroup: Bool,
                          members: [GroupMember],
                          currentUserId: String,
                          senderId: String,
                          readUserIds: [String],
                          peerId: String = "",
                          peerName: String = "") -> ReadStatusModel {
    var readIds = Set(readUserIds.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
    readIds.remove(senderId)
    if !isGroup {
        let read = peerId.isEmpty ? !readIds.isEmpty : readIds.contains(peerId)
        return ReadStatusModel(isGroup: false, peerRead: read, peerName: peerName,
                               readCount: 0, recipientCount: 0, readers: [])
    }
    let byId = Dictionary(uniqueKeysWithValues: members.map { ($0.id, $0) })
    let recipients = members.filter { !$0.id.isEmpty && $0.id != senderId }
    let readers = readIds.map { id -> ReadStatusReader in
        let member = byId[id]
        let name = member?.displayName.isEmpty == false ? member!.displayName : (member?.username ?? "")
        return ReadStatusReader(id: id, name: name, avatar: member?.avatar ?? "")
    }.sorted { $0.name < $1.name }
    return ReadStatusModel(isGroup: true, peerRead: false, peerName: "",
                           readCount: readers.count, recipientCount: recipients.count, readers: readers)
}

// MARK: - 已读状态详情弹窗

/// 消息已读状态详情（F5 #6）：私聊显示「已读/未读」，群聊显示「已读 N/M」+ 可展开已读成员。
/// 沿用聊天页蓝双勾（isReadByPeer）的同一数据源补充明细：GET .../read-states。
struct ReadStatusDetailSheet: View {
    let message: Message
    let isGroup: Bool
    let conversationTitle: String
    let members: [GroupMember]
    let currentUserId: String
    /// 私聊对端用户 id（拿不到传空，退化为「有任何人已读」判定）
    let peerId: String

    @Environment(\.dismiss) private var dismiss
    @State private var loading = true
    @State private var loadError = false
    @State private var readUserIds: [String] = []
    @State private var expanded = false

    private var model: ReadStatusModel {
        buildReadStatusModel(isGroup: isGroup, members: members, currentUserId: currentUserId,
                             senderId: message.senderId, readUserIds: readUserIds,
                             peerId: peerId, peerName: conversationTitle)
    }

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if loadError {
                    VStack(spacing: 12) {
                        Text("加载失败").foregroundColor(.vxinError)
                        Button("重试") { Task { await load() } }
                    }
                } else if !model.isGroup {
                    // 私聊：对方已读/未读
                    HStack(spacing: 12) {
                        Text(model.peerRead ? "✓✓" : "✓")
                            .font(.title3.bold())
                            .foregroundColor(model.peerRead ? .vxinGreen : .vxinTextSecondary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.peerRead ? "对方已读" : "对方未读")
                                .font(.body)
                            if !model.peerName.isEmpty {
                                Text(model.peerName).font(.footnote).foregroundColor(.vxinTextSecondary)
                            }
                        }
                        Spacer()
                    }
                    .padding()
                } else {
                    List {
                        Section {
                            Button {
                                guard model.readCount > 0 else { return }
                                withAnimation { expanded.toggle() }
                            } label: {
                                HStack {
                                    Text("已读 \(model.readCount)/\(model.recipientCount)")
                                        .foregroundColor(.primary)
                                    Spacer()
                                    if model.readCount > 0 {
                                        Text(expanded ? "收起" : "展开")
                                            .font(.footnote).foregroundColor(.vxinGreen)
                                    }
                                }
                            }
                            if model.readCount == 0 {
                                Text("暂无成员已读").font(.footnote).foregroundColor(.vxinTextSecondary)
                            }
                        }
                        if expanded {
                            Section("已读成员") {
                                ForEach(model.readers) { reader in
                                    HStack(spacing: 12) {
                                        InitialAvatar(name: reader.name.isEmpty ? "?" : reader.name, size: 36)
                                        Text(reader.name.isEmpty ? "未知成员" : reader.name)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("已读状态")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
        .task { await load() }
    }

    private func load() async {
        loading = true; loadError = false
        do {
            let states = try await ChatRepository.shared.readStates(message.conversationId, msgIds: [message.id])
            readUserIds = states[message.id] ?? []
        } catch {
            loadError = true
        }
        loading = false
    }
}
