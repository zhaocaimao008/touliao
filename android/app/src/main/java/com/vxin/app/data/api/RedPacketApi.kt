package com.vxin.app.data.api

import com.vxin.app.data.model.ClaimRedPacketResponse
import com.vxin.app.data.model.RedPacketDetail
import com.vxin.app.data.model.SendRedPacketBody
import com.vxin.app.data.model.SendRedPacketResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface RedPacketApi {

    /** 发红包（服务端建红包 + 发 red_packet 消息并广播） */
    @POST("api/redpackets/send")
    suspend fun send(@Body body: SendRedPacketBody): SendRedPacketResponse

    /** 红包详情（含领取记录） */
    @GET("api/redpackets/{packetId}")
    suspend fun detail(@Path("packetId") packetId: String): RedPacketDetail

    /** 领红包 */
    @POST("api/redpackets/{packetId}/claim")
    suspend fun claim(@Path("packetId") packetId: String): ClaimRedPacketResponse
}
