package com.vxin.app.data.repository

import com.vxin.app.data.api.GroupApi
import com.vxin.app.data.model.GroupInfo
import com.vxin.app.data.model.InviteBody
import com.vxin.app.data.model.ManageBody
import com.vxin.app.data.model.NicknameBody
import com.vxin.app.data.model.RenameGroupBody
import com.vxin.app.data.model.SetRoleBody
import com.vxin.app.data.model.UpdateGroupBody
import okhttp3.MultipartBody
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class GroupRepository @Inject constructor(
    private val groupApi: GroupApi,
    socketManager: com.vxin.app.core.realtime.SocketManager,
) {
    /** 群资料/设置/角色/成员变更 → convId */
    val groupChangedEvents = socketManager.groupChangedEvents
    /** 被踢/群解散 → convId */
    val groupGoneEvents = socketManager.groupGoneEvents

    suspend fun info(conversationId: String): GroupInfo = groupApi.info(conversationId)

    suspend fun rename(conversationId: String, name: String) =
        groupApi.rename(conversationId, RenameGroupBody(name))

    suspend fun setAnnouncement(conversationId: String, announcement: String) =
        groupApi.updateInfo(conversationId, UpdateGroupBody(announcement = announcement))

    suspend fun setAvatar(conversationId: String, part: MultipartBody.Part): String =
        groupApi.setAvatar(conversationId, part).avatar

    suspend fun setNickname(conversationId: String, nickname: String) =
        groupApi.setNickname(conversationId, NicknameBody(nickname))

    suspend fun manage(conversationId: String, body: ManageBody) =
        groupApi.manage(conversationId, body)

    suspend fun setRole(conversationId: String, userId: String, role: String) =
        groupApi.setRole(conversationId, userId, SetRoleBody(role))

    suspend fun transferOwner(conversationId: String, userId: String) =
        groupApi.transferOwner(conversationId, com.vxin.app.data.model.TransferOwnerBody(userId))

    suspend fun invite(conversationId: String, userIds: List<String>) =
        groupApi.invite(conversationId, InviteBody(userIds))

    suspend fun kick(conversationId: String, userId: String) =
        groupApi.kick(conversationId, userId)

    suspend fun leave(conversationId: String) = groupApi.leave(conversationId)
    suspend fun dissolve(conversationId: String) = groupApi.dissolve(conversationId)

    suspend fun qrCode(conversationId: String) = groupApi.qrCode(conversationId)

    suspend fun join(token: String) = groupApi.join(token)
}
