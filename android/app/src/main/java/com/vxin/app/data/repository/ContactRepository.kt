package com.vxin.app.data.repository

import com.vxin.app.data.api.ContactApi
import com.vxin.app.data.api.MessageApi
import com.vxin.app.data.model.Contact
import com.vxin.app.data.model.CreateGroupBody
import com.vxin.app.data.model.CreatePrivateBody
import com.vxin.app.data.model.FriendRequest
import com.vxin.app.data.model.FriendRequestBody
import com.vxin.app.data.model.HandleRequestBody
import com.vxin.app.data.model.SearchUser
import com.vxin.app.data.model.SendRequestResponse
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ContactRepository @Inject constructor(
    private val contactApi: ContactApi,
    private val messageApi: MessageApi,
    socketManager: com.vxin.app.core.realtime.SocketManager,
) {
    /** 好友申请相关实时事件（新申请/被通过） */
    val friendEvents = socketManager.friendEvents
    /** 联系人在线/离线 */
    val presenceEvents = socketManager.presenceEvents

    suspend fun contacts(): List<Contact> = contactApi.contacts()

    suspend fun search(q: String): List<SearchUser> = contactApi.search(q)

    suspend fun sendFriendRequest(toId: String, message: String): SendRequestResponse =
        contactApi.sendRequest(FriendRequestBody(toId, message))

    suspend fun receivedRequests(): List<FriendRequest> = contactApi.receivedRequests()

    suspend fun sentRequests() = contactApi.sentRequests()

    suspend fun handleRequest(id: String, accept: Boolean) =
        contactApi.handleRequest(id, HandleRequestBody(if (accept) "accept" else "reject"))

    suspend fun deleteContact(id: String) = contactApi.deleteContact(id)

    suspend fun setRemark(id: String, remark: String) =
        contactApi.setRemark(id, com.vxin.app.data.model.RemarkBody(remark))

    suspend fun block(id: String) = contactApi.block(id)

    suspend fun unblock(id: String) = contactApi.unblock(id)

    suspend fun blocked() = contactApi.blocked()

    /** 创建/获取私聊会话，返回 conversationId */
    suspend fun createPrivate(userId: String): String =
        messageApi.createPrivate(CreatePrivateBody(userId)).conversationId

    /** 创建群聊，返回 conversationId */
    suspend fun createGroup(name: String, memberIds: List<String>): String =
        messageApi.createGroup(CreateGroupBody(name, memberIds)).conversationId
}
