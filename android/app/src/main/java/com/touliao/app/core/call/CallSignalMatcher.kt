package com.touliao.app.core.call

/** Correlates a realtime signal with the active peer call. Empty event IDs are
 * accepted only for compatibility with servers/clients that predate call IDs. */
object CallSignalMatcher {
    fun matches(activeCallId: String, eventCallId: String, activePeerId: String, eventPeerId: String): Boolean {
        if (activePeerId != eventPeerId) return false
        return eventCallId.isEmpty() || eventCallId == activeCallId
    }

    fun matchesEnd(
        activeCallId: String,
        eventCallId: String,
        activePeerId: String,
        eventPeerId: String,
        reason: String,
    ): Boolean {
        if (reason == "server_restarted") {
            return eventCallId.isNotEmpty() && eventCallId == activeCallId
        }
        return matches(activeCallId, eventCallId, activePeerId, eventPeerId)
    }

    fun canResume(activeCallId: String, participatingCallId: String): Boolean =
        activeCallId.isNotEmpty() && activeCallId == participatingCallId
}
