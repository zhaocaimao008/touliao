package com.vxin.app.data.api

import com.vxin.app.data.model.BlockedUser
import com.vxin.app.data.model.Contact
import com.vxin.app.data.model.FriendRequest
import com.vxin.app.data.model.FriendRequestBody
import com.vxin.app.data.model.HandleRequestBody
import com.vxin.app.data.model.RemarkBody
import com.vxin.app.data.model.SearchUser
import com.vxin.app.data.model.SendRequestResponse
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

interface ContactApi {

    @GET("api/users/contacts")
    suspend fun contacts(): List<Contact>

    /** 搜索用户（手机号 / v信号 / 用户名） */
    @GET("api/users/search")
    suspend fun search(@Query("q") q: String): List<SearchUser>

    @POST("api/users/friend-request")
    suspend fun sendRequest(@Body body: FriendRequestBody): SendRequestResponse

    @GET("api/users/friend-requests")
    suspend fun receivedRequests(): List<FriendRequest>

    /** action = accept | reject */
    @POST("api/users/friend-request/{id}/handle")
    suspend fun handleRequest(@Path("id") id: String, @Body body: HandleRequestBody)

    /** 删除好友 */
    @DELETE("api/users/contacts/{id}")
    suspend fun deleteContact(@Path("id") id: String)

    /** 设置好友备注 */
    @PUT("api/users/contacts/{id}/remark")
    suspend fun setRemark(@Path("id") id: String, @Body body: RemarkBody)

    /** 加入黑名单 */
    @POST("api/users/block/{id}")
    suspend fun block(@Path("id") id: String)

    /** 移出黑名单 */
    @DELETE("api/users/block/{id}")
    suspend fun unblock(@Path("id") id: String)

    /** 黑名单列表 */
    @GET("api/users/me/blocked")
    suspend fun blocked(): List<BlockedUser>
}
