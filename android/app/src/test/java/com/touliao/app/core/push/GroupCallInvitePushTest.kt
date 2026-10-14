package com.touliao.app.core.push

import com.touliao.app.core.call.CallIntents
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class GroupCallInvitePushTest {

    /** 与后端 push.js pushGroupCallInvite 的 FCM data 同形（值全部为字符串） */
    private fun fcm(): MutableMap<String, String> = mutableMapOf(
        "type" to "group_call_invite",
        "recipientId" to "u-me",
        "callId" to "call-1",
        "conversationId" to "conv-1",
        "callType" to "video",
        "fromId" to "u-alice",
        "fromName" to "alice",
        "groupName" to "周末爬山",
        "expiresAt" to "1760000060000",
        "senderName" to "周末爬山",
        "body" to "alice 邀请你加入群视频通话",
        "messageId" to "call-1",
    )

    private fun parse(map: Map<String, String>) = GroupCallInvitePush.parse { map[it] }

    @Test
    fun typeConstant() {
        assertEquals("group_call_invite", GroupCallInvitePush.TYPE)
    }

    @Test
    fun parsesFullFcmPayload() {
        val p = parse(fcm())!!
        assertEquals("u-me", p.recipientId)
        assertEquals("周末爬山", p.groupName)
        assertEquals("call-1", p.event.callId)
        assertEquals("conv-1", p.event.conversationId)
        assertEquals("video", p.event.type)
        assertEquals("u-alice", p.event.from)
        assertEquals("alice", p.event.fromName)
        assertEquals("", p.event.fromAvatar)
        assertEquals(1760000060000L, p.event.expiresAt)
    }

    @Test
    fun callTypeOtherThanVideoIsAudio() {
        assertEquals("audio", parse(fcm().apply { put("callType", "audio") })!!.event.type)
        assertEquals("audio", parse(fcm().apply { put("callType", "VIDEO") })!!.event.type)
        assertEquals("audio", parse(fcm().apply { put("callType", "screen") })!!.event.type)
        assertEquals("audio", parse(fcm().apply { remove("callType") })!!.event.type)
    }

    @Test
    fun missingRequiredIdsReturnNull() {
        assertNull(parse(fcm().apply { remove("recipientId") }))
        assertNull(parse(fcm().apply { remove("callId") }))
        assertNull(parse(fcm().apply { remove("conversationId") }))
        assertNull(parse(fcm().apply { put("recipientId", "") }))
        assertNull(parse(fcm().apply { put("callId", "") }))
        assertNull(parse(fcm().apply { put("conversationId", "") }))
    }

    @Test
    fun invalidExpiresAtReturnsNull() {
        assertNull(parse(fcm().apply { remove("expiresAt") }))
        assertNull(parse(fcm().apply { put("expiresAt", "") }))
        assertNull(parse(fcm().apply { put("expiresAt", "abc") }))
        assertNull(parse(fcm().apply { put("expiresAt", "1.5") }))
        assertNull(parse(fcm().apply { put("expiresAt", "0") }))
        assertNull(parse(fcm().apply { put("expiresAt", "-1000") }))
    }

    @Test
    fun selfInviteReturnsNull() {
        assertNull(parse(fcm().apply { put("fromId", "u-me") }))
    }

    @Test
    fun missingFromIdIsAllowed() {
        val p = parse(fcm().apply { remove("fromId") })
        assertNotNull(p)
        assertEquals("", p?.event?.from)
    }

    @Test
    fun optionalNamesDefaultToEmpty() {
        val p = parse(fcm().apply { remove("fromName"); remove("groupName") })
        assertNotNull(p)
        assertEquals("", p?.event?.fromName)
        assertEquals("", p?.groupName)
    }

    @Test
    fun vendorExtraKeysMatchCallIntents() {
        assertEquals(CallIntents.EXTRA_GROUP_CALL_ID, GroupCallInvitePush.vendorExtraKey("callId"))
        assertEquals(CallIntents.EXTRA_GROUP_CALL_TYPE, GroupCallInvitePush.vendorExtraKey("callType"))
        assertEquals(CallIntents.EXTRA_GROUP_CALL_FROM_ID, GroupCallInvitePush.vendorExtraKey("fromId"))
        assertEquals(CallIntents.EXTRA_GROUP_CALL_FROM_NAME, GroupCallInvitePush.vendorExtraKey("fromName"))
        assertEquals(CallIntents.EXTRA_GROUP_INVITE_EXPIRES_AT, GroupCallInvitePush.vendorExtraKey("expiresAt"))
        assertEquals("recipientId", GroupCallInvitePush.vendorExtraKey("recipientId"))
        assertEquals("conversationId", GroupCallInvitePush.vendorExtraKey("conversationId"))
        assertEquals("groupName", GroupCallInvitePush.vendorExtraKey("groupName"))
        // 与后端厂商通道 intent 的 S.xxx 键逐字一致
        assertEquals("groupCallId", GroupCallInvitePush.vendorExtraKey("callId"))
        assertEquals("groupCallType", GroupCallInvitePush.vendorExtraKey("callType"))
        assertEquals("groupCallFromId", GroupCallInvitePush.vendorExtraKey("fromId"))
        assertEquals("groupCallFromName", GroupCallInvitePush.vendorExtraKey("fromName"))
        assertEquals("groupInviteExpiresAt", GroupCallInvitePush.vendorExtraKey("expiresAt"))
    }

    @Test
    fun parsesVendorIntentExtras() {
        // 后端 pushGroupCallInviteToCid 的厂商通道 intent 只带这些 S.xxx extra（没有群名）
        val vendor = mapOf(
            "recipientId" to "u-me",
            "conversationId" to "conv-1",
            "groupCallId" to "call-1",
            "groupCallType" to "audio",
            "groupCallFromId" to "u-alice",
            "groupCallFromName" to "alice",
            "groupInviteExpiresAt" to "1760000060000",
        )
        val p = GroupCallInvitePush.parse { vendor[GroupCallInvitePush.vendorExtraKey(it)] }!!
        assertEquals("u-me", p.recipientId)
        assertEquals("", p.groupName)
        assertEquals("call-1", p.event.callId)
        assertEquals("conv-1", p.event.conversationId)
        assertEquals("audio", p.event.type)
        assertEquals("u-alice", p.event.from)
        assertEquals("alice", p.event.fromName)
        assertEquals(1760000060000L, p.event.expiresAt)
    }
}
