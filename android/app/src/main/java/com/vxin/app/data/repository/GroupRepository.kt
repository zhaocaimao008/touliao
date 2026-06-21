package com.vxin.app.data.repository

import com.vxin.app.data.api.GroupApi
import com.vxin.app.data.model.GroupInfo
import com.vxin.app.data.model.InviteBody
import com.vxin.app.data.model.RenameGroupBody
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class GroupRepository @Inject constructor(
    private val groupApi: GroupApi,
) {
    suspend fun info(conversationId: String): GroupInfo = groupApi.info(conversationId)

    suspend fun rename(conversationId: String, name: String) =
        groupApi.rename(conversationId, RenameGroupBody(name))

    suspend fun invite(conversationId: String, userIds: List<String>) =
        groupApi.invite(conversationId, InviteBody(userIds))

    suspend fun kick(conversationId: String, userId: String) =
        groupApi.kick(conversationId, userId)

    suspend fun leave(conversationId: String) = groupApi.leave(conversationId)
}
