import Foundation
import UIKit

@MainActor
final class GroupInfoViewModel: ObservableObject {
    @Published var info: GroupInfo?
    @Published var loading = true
    @Published var uploadingAvatar = false
    @Published var left = false
    @Published var error: String?

    let conversationId: String
    private let repo = GroupRepository.shared

    init(conversationId: String) {
        self.conversationId = conversationId
    }

    func refresh() async {
        loading = true
        do { info = try await repo.info(conversationId) }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "加载群信息失败" }
        loading = false
    }

    func rename(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        Task {
            do {
                try await repo.rename(conversationId, name: trimmed)
                info?.name = trimmed
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "改名失败" }
        }
    }

    func setAnnouncement(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            do {
                try await repo.setAnnouncement(conversationId, announcement: trimmed)
                info?.announcement = trimmed
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "设置群公告失败" }
        }
    }

    func setNickname(_ nickname: String, myId: String) {
        let trimmed = nickname.trimmingCharacters(in: .whitespaces)
        Task {
            do {
                try await repo.setNickname(conversationId, nickname: trimmed)
                if let idx = info?.members.firstIndex(where: { $0.id == myId }) {
                    info?.members[idx].nickname = trimmed.isEmpty ? nil : trimmed
                }
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "设置群昵称失败" }
        }
    }

    func setAvatar(data: Data) {
        guard !uploadingAvatar else { return }
        uploadingAvatar = true
        Task {
            defer { uploadingAvatar = false }
            do {
                let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.85) ?? data
                let url = try await repo.setAvatar(conversationId, data: jpeg, fileName: "group.jpg")
                info?.avatar = url
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "群头像上传失败" }
        }
    }

    func setRole(_ member: GroupMember, makeAdmin: Bool) {
        let role = makeAdmin ? "admin" : "member"
        Task {
            do {
                try await repo.setRole(conversationId, userId: member.id, role: role)
                if let idx = info?.members.firstIndex(where: { $0.id == member.id }) {
                    info?.members[idx].role = role
                }
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "设置角色失败" }
        }
    }

    func transferOwner(_ member: GroupMember) {
        Task {
            do {
                try await repo.transferOwner(conversationId, userId: member.id)
                await refresh()   // 我已变普通成员，刷新权限
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "转让群主失败" }
        }
    }

    func setManage(muteAll: Bool? = nil, noPrivateChat: Bool? = nil, noAddFriend: Bool? = nil) {
        Task {
            do {
                try await repo.manage(conversationId, muteAll: muteAll, noPrivateChat: noPrivateChat, noAddFriend: noAddFriend)
                if let v = muteAll { info?.muteAll = v ? 1 : 0 }
                if let v = noPrivateChat { info?.noPrivateChat = v ? 1 : 0 }
                if let v = noAddFriend { info?.noAddFriend = v ? 1 : 0 }
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "设置失败" }
        }
    }

    func kick(_ member: GroupMember) {
        Task {
            do {
                try await repo.kick(conversationId, userId: member.id)
                info?.members.removeAll { $0.id == member.id }
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "移除失败" }
        }
    }

    func leave() {
        Task {
            do { try await repo.leave(conversationId); left = true }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "退群失败" }
        }
    }
}
