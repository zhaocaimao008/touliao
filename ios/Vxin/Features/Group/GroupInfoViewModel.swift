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
