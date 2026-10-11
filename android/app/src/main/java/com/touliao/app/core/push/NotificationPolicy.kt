package com.touliao.app.core.push

/** Shared wire identities: keep in sync with backend notificationPresentation.js. */
object NotificationPolicy {
    fun tag(recipientId: String, conversationId: String) = "touliao:$recipientId:$conversationId"
    fun vendorId(recipientId: String, conversationId: String) =
        0x20000000 or (tag(recipientId, conversationId).hashCode() and 0x0fffffff)
    fun channel(sound: Boolean, vibrate: Boolean) =
        "touliao_messages_s${if (sound) 1 else 0}_v${if (vibrate) 1 else 0}"
}
