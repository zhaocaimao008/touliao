package com.touliao.app.data.repository

import com.touliao.app.data.api.RedPacketApi
import com.touliao.app.core.network.RequestKeys
import com.touliao.app.core.storage.AccountStore
import com.touliao.app.core.storage.TokenStore
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import com.touliao.app.data.model.ClaimRedPacketResponse
import com.touliao.app.data.model.RedPacketDetail
import com.touliao.app.data.model.SendRedPacketBody
import com.touliao.app.data.model.SendRedPacketResponse
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class RedPacketRepository @Inject constructor(
    private val api: RedPacketApi,
    private val accountStore: AccountStore,
    private val tokenStore: TokenStore,
    private val json: Json,
    private val requestKeys: RequestKeys,
) {
    suspend fun send(conversationId: String, totalAmount: Int, totalCount: Int, greeting: String, owner: TokenStore.Snapshot = tokenStore.snapshot()): SendRedPacketResponse {
        if (!tokenStore.isCurrent(owner)) throw java.io.IOException("Account changed before red packet")
        val body = SendRedPacketBody(conversationId, totalAmount, totalCount, greeting)
        val payload = json.encodeToString(body)
        val scope = "${owner.origin}:${accountStore.activeId()}:${owner.identityEpoch}"
        val key = requestKeys.key(scope, "redpacket", payload)
        val result = api.send(body, key, owner)
        requestKeys.complete(scope, "redpacket", payload, key)
        return result
    }

    suspend fun detail(packetId: String): RedPacketDetail = api.detail(packetId)

    suspend fun claim(packetId: String): ClaimRedPacketResponse = api.claim(packetId)
}
