package com.vxin.app.data.api

import com.vxin.app.data.model.FriendLabel
import com.vxin.app.data.model.FriendLabelBody
import com.vxin.app.data.model.FriendLabelMemberBody
import com.vxin.app.data.model.SuccessResponse
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path

/** 好友标签/分组。 */
interface FriendLabelApi {
    @GET("api/friend-labels")
    suspend fun list(): List<FriendLabel>

    @POST("api/friend-labels")
    suspend fun create(@Body body: FriendLabelBody): FriendLabel

    @PUT("api/friend-labels/{id}")
    suspend fun update(@Path("id") id: String, @Body body: FriendLabelBody): FriendLabel

    @DELETE("api/friend-labels/{id}")
    suspend fun delete(@Path("id") id: String): SuccessResponse

    @POST("api/friend-labels/{id}/members")
    suspend fun addMember(@Path("id") id: String, @Body body: FriendLabelMemberBody): FriendLabel

    @DELETE("api/friend-labels/{id}/members/{friendId}")
    suspend fun removeMember(@Path("id") id: String, @Path("friendId") friendId: String): SuccessResponse
}
