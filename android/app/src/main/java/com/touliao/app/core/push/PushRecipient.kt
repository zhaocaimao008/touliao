package com.touliao.app.core.push

object PushRecipient {
    fun matches(recipientId: String?, currentUserId: String?, loggedIn: Boolean): Boolean =
        loggedIn && !recipientId.isNullOrBlank() && recipientId == currentUserId
}
