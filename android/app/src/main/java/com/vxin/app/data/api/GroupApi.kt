package com.vxin.app.data.api

import com.vxin.app.data.model.AvatarResponse
import com.vxin.app.data.model.GroupInfo
import com.vxin.app.data.model.GroupQr
import com.vxin.app.data.model.InviteBody
import com.vxin.app.data.model.JoinGroupResult
import com.vxin.app.data.model.ManageBody
import com.vxin.app.data.model.NicknameBody
import com.vxin.app.data.model.RenameGroupBody
import com.vxin.app.data.model.SetRoleBody
import com.vxin.app.data.model.TransferOwnerBody
import com.vxin.app.data.model.UpdateGroupBody
import okhttp3.MultipartBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path

interface GroupApi {

    @GET("api/messages/conversation/{id}/info")
    suspend fun info(@Path("id") id: String): GroupInfo

    /** 改群名（仅群主/管理员） */
    @PUT("api/messages/conversation/{id}")
    suspend fun rename(@Path("id") id: String, @Body body: RenameGroupBody)

    /** 更新群名 / 群公告（仅群主/管理员） */
    @PUT("api/messages/conversation/{id}")
    suspend fun updateInfo(@Path("id") id: String, @Body body: UpdateGroupBody)

    /** 群头像（仅群主/管理员，multipart 字段 avatar） */
    @Multipart
    @PUT("api/messages/conversation/{id}/avatar")
    suspend fun setAvatar(@Path("id") id: String, @Part avatar: MultipartBody.Part): AvatarResponse

    /** 设置我的群昵称（任意成员） */
    @PUT("api/messages/conversation/{id}/nickname")
    suspend fun setNickname(@Path("id") id: String, @Body body: NicknameBody)

    /** 群管理设置：全员禁言 / 禁止私聊 / 禁止加好友（群主、管理员） */
    @PUT("api/messages/conversation/{id}/manage")
    suspend fun manage(@Path("id") id: String, @Body body: ManageBody)

    /** 设置成员角色（仅群主） */
    @PUT("api/messages/conversation/{id}/members/{uid}/role")
    suspend fun setRole(@Path("id") id: String, @Path("uid") uid: String, @Body body: SetRoleBody)

    /** 转让群主（仅群主） */
    @POST("api/messages/conversation/{id}/transfer-owner")
    suspend fun transferOwner(@Path("id") id: String, @Body body: TransferOwnerBody)

    /** 邀请成员 */
    @POST("api/messages/conversation/{id}/invite")
    suspend fun invite(@Path("id") id: String, @Body body: InviteBody)

    /** 移除成员（仅群主/管理员） */
    @DELETE("api/messages/conversation/{id}/members/{uid}")
    suspend fun kick(@Path("id") id: String, @Path("uid") uid: String)

    /** 退出群聊（非群主专用） */
    @POST("api/messages/conversation/{id}/leave")
    suspend fun leave(@Path("id") id: String)

    /** 解散群聊（仅群主） */
    @POST("api/messages/conversation/{id}/dissolve")
    suspend fun dissolve(@Path("id") id: String)

    /** 群二维码 + 邀请链接（任意成员） */
    @GET("api/messages/conversation/{id}/qr-code")
    suspend fun qrCode(@Path("id") id: String): GroupQr

    /** 通过邀请 token 进群 */
    @POST("api/messages/join/{token}")
    suspend fun join(@Path("token") token: String): JoinGroupResult
}
