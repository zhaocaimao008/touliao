package com.touliao.app.core.push

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.rule.GrantPermissionRule
import com.touliao.app.core.storage.AccountStore
import com.touliao.app.core.storage.TokenStore
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NotificationPresentationTest {
    @get:Rule val permission: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.POST_NOTIFICATIONS)
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val manager = context.getSystemService(NotificationManager::class.java)
    private lateinit var helper: NotificationHelper

    @Before fun prepare() {
        manager.cancelAll()
        val tokenPrefs = context.getSharedPreferences("notification-test-tokens", Context.MODE_PRIVATE)
        tokenPrefs.edit().clear().commit()
        val tokens = TokenStore(tokenPrefs).apply { token = "isolated-test-token" }
        val accounts = AccountStore(context.getSharedPreferences("notification-test-accounts", Context.MODE_PRIVATE), Json, tokens)
        accounts.setActive("fixture-user")
        helper = NotificationHelper(context, accounts, tokens)
        helper.clearAccountNotifications()
    }
    private fun settle() { Thread.sleep(350) }
    private fun card(conversation: String) = manager.activeNotifications.firstOrNull { it.tag == NotificationPolicy.tag("fixture-user", conversation) }

    @Test fun duplicateMessagesAreIgnoredAndFivePreviewLinesDoNotCapUnreadCount() {
        for (i in 1..8) {
            helper.showMessageNotification("Fixture", "message $i", "one", recipientId="fixture-user", messageId="m$i", sound=false)
            settle() // Keep the fixture below Android's platform notification update rate limit.
        }
        helper.showMessageNotification("Fixture", "duplicate", "one", recipientId="fixture-user", messageId="m8", sound=false)
        settle()
        val notification = requireNotNull(card("one")).notification
        assertEquals(8, notification.number)
        assertEquals(5, notification.extras.getCharSequenceArray(android.app.Notification.EXTRA_TEXT_LINES)?.size)
        assertEquals(android.app.Notification.VISIBILITY_PRIVATE, notification.visibility)
        assertEquals("touliao_messages_s0_v0", notification.channelId)
    }

    @Test fun readingOneConversationPreservesOtherCardAndUpdatesSummary() {
        helper.showMessageNotification("One", "x", "one", unreadCount=7, messageId="a", sound=false)
        helper.showMessageNotification("Two", "y", "two", unreadCount=2, messageId="b", sound=false)
        settle()
        assertTrue(manager.activeNotifications.any { it.id == NotificationHelper.SUMMARY_NOTIFICATION_ID })
        assertNotNull(card("two"))
        helper.clearConversationNotifications("one")
        settle()
        assertNull(card("one"))
        assertEquals(2, requireNotNull(card("two")).notification.number)
        val summary = manager.activeNotifications.first { it.id == NotificationHelper.SUMMARY_NOTIFICATION_ID }.notification
        assertEquals("2 条新消息", summary.extras.getCharSequence(android.app.Notification.EXTRA_TEXT)?.toString())
        helper.clearConversationNotifications("two")
        settle()
        assertFalse(manager.activeNotifications.any { it.id == NotificationHelper.SUMMARY_NOTIFICATION_ID })
    }

    @Test fun readingClearsSystemDisplayedFcmAndVendorNotificationIdentities() {
        val channel = NotificationPolicy.channel(false, false)
        val n = android.app.Notification.Builder(context, channel).setSmallIcon(com.touliao.app.R.drawable.ic_notification).setContentTitle("fixture").build()
        manager.notify(NotificationPolicy.tag("fixture-user", "one"), 0, n)
        manager.notify(NotificationPolicy.vendorId("fixture-user", "one"), n)
        settle()
        helper.clearConversationNotifications("one")
        settle()
        assertNull(card("one"))
        assertFalse(manager.activeNotifications.any { it.id == NotificationPolicy.vendorId("fixture-user", "one") })
    }

    @Test fun silentChannelsHaveNoSoundAndWrongAccountNeverDisplays() {
        assertNull(manager.getNotificationChannel(NotificationPolicy.channel(false,false)).sound)
        assertFalse(manager.getNotificationChannel(NotificationPolicy.channel(false,false)).shouldVibrate())
        helper.showMessageNotification("Other", "secret", "wrong", recipientId="other-user", messageId="wrong")
        settle()
        assertNull(card("wrong"))
    }
}
