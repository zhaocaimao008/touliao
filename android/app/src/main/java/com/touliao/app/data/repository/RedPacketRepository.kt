package com.touliao.app.data.repository

import com.touliao.app.data.api.RedPacketApi
import com.touliao.app.data.model.ClaimRedPacketResponse
import com.touliao.app.data.model.RedPacketDetail
import com.touliao.app.data.model.SendRedPacketBody
import com.touliao.app.data.model.SendRedPacketResponse
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class RedPacketRepository @Inject constructor(
    private val api: RedPacketApi,
) {
    suspend fun send(conversationId: String, totalAmount: Int, totalCount: Int, greeting: String): SendRedPacketResponse =
        api.send(SendRedPacketBody(conversationId, totalAmount, totalCount, greeting))

    suspend fun detail(packetId: String): RedPacketDetail = api.detail(packetId)

    suspend fun claim(packetId: String): ClaimRedPacketResponse = api.claim(packetId)
}
