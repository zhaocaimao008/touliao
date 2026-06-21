package com.vxin.app.data.api

import com.vxin.app.data.model.GroupInfo
import com.vxin.app.data.model.InviteBody
import com.vxin.app.data.model.RenameGroupBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path

interface GroupApi {

    @GET("api/messages/conversation/{id}/info")
    suspend fun info(@Path("id") id: String): GroupInfo

    /** 改群名（仅群主/管理员） */
    @PUT("api/messages/conversation/{id}")
    suspend fun rename(@Path("id") id: String, @Body body: RenameGroupBody)

    /** 邀请成员 */
    @POST("api/messages/conversation/{id}/invite")
    suspend fun invite(@Path("id") id: String, @Body body: InviteBody)

    /** 移除成员（仅群主/管理员） */
    @DELETE("api/messages/conversation/{id}/members/{uid}")
    suspend fun kick(@Path("id") id: String, @Path("uid") uid: String)

    /** 退出群聊 */
    @POST("api/messages/conversation/{id}/leave")
    suspend fun leave(@Path("id") id: String)
}
