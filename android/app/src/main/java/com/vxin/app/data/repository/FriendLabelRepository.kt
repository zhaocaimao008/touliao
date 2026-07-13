package com.vxin.app.data.repository

import com.vxin.app.data.api.FriendLabelApi
import com.vxin.app.data.model.FriendLabel
import com.vxin.app.data.model.FriendLabelBody
import com.vxin.app.data.model.FriendLabelMemberBody
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FriendLabelRepository @Inject constructor(
    private val api: FriendLabelApi,
) {
    suspend fun list(): List<FriendLabel> = api.list()
    suspend fun create(name: String, color: String? = null): FriendLabel = api.create(FriendLabelBody(name, color))
    suspend fun rename(id: String, name: String, color: String? = null): FriendLabel = api.update(id, FriendLabelBody(name, color))
    suspend fun delete(id: String) = api.delete(id)
    suspend fun addMember(id: String, friendId: String): FriendLabel = api.addMember(id, FriendLabelMemberBody(friendId))
    suspend fun removeMember(id: String, friendId: String) = api.removeMember(id, friendId)
}
