package com.touliao.app.core.call

/** Correlates a realtime signal with the active peer call. Empty event IDs are
 * accepted only for compatibility with servers/clients that predate call IDs. */
object CallSignalMatcher {
    fun matches(activeCallId: String, eventCallId: String, activePeerId: String, eventPeerId: String): Boolean {
        if (activePeerId != eventPeerId) return false
        return eventCallId.isEmpty() || eventCallId == activeCallId
    }
}
