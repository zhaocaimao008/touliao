package com.vxin.app.data.api

import com.vxin.app.data.model.Conversation
import com.vxin.app.data.model.CreateConversationResponse
import com.vxin.app.data.model.CreateGroupBody
import com.vxin.app.data.model.CreatePrivateBody
import com.vxin.app.data.model.DeleteMessageBody
import com.vxin.app.data.model.MarkReadRequest
import com.vxin.app.data.model.Message
import com.vxin.app.data.model.PinMessageBody
import com.vxin.app.data.model.PinnedMessage
import com.vxin.app.data.model.ChunkReceivedResponse
import com.vxin.app.data.model.ReactBody
import com.vxin.app.data.model.ReactResponse
import com.vxin.app.data.model.UploadFinishBody
import com.vxin.app.data.model.UploadInitBody
import com.vxin.app.data.model.UploadInitResponse
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

interface MessageApi {

    /** 会话列表（含最后一条消息、未读数等派生字段） */
    @GET("api/messages/conversations")
    suspend fun conversations(): List<Conversation>

    /** 某会话历史消息，升序返回；分页用 before（早于该时间戳，epoch 秒） */
    @GET("api/messages/{conversationId}")
    suspend fun history(
        @Path("conversationId") conversationId: String,
        @Query("limit") limit: Int = 50,
        @Query("before") before: Long? = null,
    ): List<Message>

    /** 会话内消息全文搜索（FTS5），按时间倒序返回命中消息 */
    @GET("api/messages/conversation/{convId}/search")
    suspend fun searchInConversation(
        @Path("convId") convId: String,
        @Query("q") q: String,
    ): List<Message>

    /** 上传媒体（图片/语音/文件）。字段名固定为 file；服务端按 MIME 判定 type，返回创建的消息 */
    @Multipart
    @POST("api/messages/{conversationId}/upload")
    suspend fun upload(
        @Path("conversationId") conversationId: String,
        @Part file: MultipartBody.Part,
    ): Message

    /** 分片上传：初始化会话 */
    @POST("api/messages/{conversationId}/upload-init")
    suspend fun uploadInit(
        @Path("conversationId") conversationId: String,
        @Body body: UploadInitBody,
    ): UploadInitResponse

    /** 分片上传：上传一块原始数据（application/octet-stream） */
    @PUT("api/messages/{conversationId}/upload-chunk/{uploadId}")
    suspend fun uploadChunk(
        @Path("conversationId") conversationId: String,
        @Path("uploadId") uploadId: String,
        @Query("offset") offset: Long,
        @Body body: RequestBody,
    ): ChunkReceivedResponse

    /** 分片上传：合并并完成，返回消息对象 */
    @POST("api/messages/{conversationId}/upload-finish/{uploadId}")
    suspend fun uploadFinish(
        @Path("conversationId") conversationId: String,
        @Path("uploadId") uploadId: String,
        @Body body: UploadFinishBody = UploadFinishBody(),
    ): Message

    /** 标记会话已读（服务端会向房间发 message_read、向本人各端发 sync:unread_cleared） */
    @POST("api/messages/conversation/{conversationId}/read")
    suspend fun markRead(
        @Path("conversationId") conversationId: String,
        @Body body: MarkReadRequest,
    )

    /** 获取/创建与某用户的私聊会话 */
    @POST("api/messages/conversation/private")
    suspend fun createPrivate(@Body body: CreatePrivateBody): CreateConversationResponse

    /** 创建群聊 */
    @POST("api/messages/conversation/group")
    suspend fun createGroup(@Body body: CreateGroupBody): CreateConversationResponse

    /** 撤回/删除消息 */
    @HTTP(method = "DELETE", path = "api/messages/{msgId}", hasBody = true)
    suspend fun deleteMessage(@Path("msgId") msgId: String, @Body body: DeleteMessageBody)

    /** 批量撤回/删除消息（多选，单次≤20 条） */
    @POST("api/messages/batch-delete")
    suspend fun batchDelete(@Body body: com.vxin.app.data.model.BatchDeleteBody)

    /** 表情回应(切换) */
    @POST("api/messages/{msgId}/react")
    suspend fun react(@Path("msgId") msgId: String, @Body body: ReactBody): ReactResponse

    /** 收藏消息 */
    @POST("api/messages/{msgId}/collect")
    suspend fun collectMessage(@Path("msgId") msgId: String)

    /** 编辑消息（本人文本，2 分钟内） */
    @PUT("api/messages/{msgId}/edit")
    suspend fun editMessage(@Path("msgId") msgId: String, @Body body: com.vxin.app.data.model.EditMessageBody)

    /** 转发消息到多个会话 */
    @POST("api/messages/forward")
    suspend fun forward(@Body body: com.vxin.app.data.model.ForwardBody)

    /** 会话置顶（pinned: 1/0） */
    @POST("api/messages/conversation/{convId}/pin")
    suspend fun pinConversation(@Path("convId") convId: String, @Body body: com.vxin.app.data.model.PinConversationBody)

    /** 会话免打扰（muted: 1/0） */
    @POST("api/messages/conversation/{convId}/mute")
    suspend fun muteConversation(@Path("convId") convId: String, @Body body: com.vxin.app.data.model.MuteConversationBody)

    /** 聊天专属背景（background 为图片 URL，空串=清除） */
    @PUT("api/messages/conversation/{convId}/background")
    suspend fun setBackground(@Path("convId") convId: String, @Body body: com.vxin.app.data.model.BackgroundBody)

    /** 清空聊天记录 */
    @DELETE("api/messages/conversation/{convId}/messages")
    suspend fun clearMessages(@Path("convId") convId: String)

    /** 置顶消息（群内，任意成员） */
    @POST("api/messages/conversation/{convId}/pin-message")
    suspend fun pinMessage(@Path("convId") convId: String, @Body body: PinMessageBody)

    /** 取消置顶 */
    @DELETE("api/messages/conversation/{convId}/pin-message/{msgId}")
    suspend fun unpinMessage(@Path("convId") convId: String, @Path("msgId") msgId: String)

    /** 置顶消息列表 */
    @GET("api/messages/conversation/{convId}/pinned-messages")
    suspend fun pinnedMessages(@Path("convId") convId: String): List<PinnedMessage>
}
