import Foundation

/// Correlates a realtime call signal with the currently active peer call.
/// Empty event call IDs are accepted only for compatibility with servers/clients
/// that predate call IDs. Mirrors android/.../core/call/CallSignalMatcher.kt exactly.
enum CallSignalMatcher {
    static func matches(activeCallId: String, eventCallId: String, activePeerId: String, eventPeerId: String) -> Bool {
        guard activePeerId == eventPeerId else { return false }
        return eventCallId.isEmpty || eventCallId == activeCallId
    }

    static func matchesEnd(
        activeCallId: String,
        eventCallId: String,
        activePeerId: String,
        eventPeerId: String,
        reason: String
    ) -> Bool {
        if reason == "server_restarted" {
            return !eventCallId.isEmpty && eventCallId == activeCallId
        }
        return matches(activeCallId: activeCallId, eventCallId: eventCallId, activePeerId: activePeerId, eventPeerId: eventPeerId)
    }

    static func canResume(
        activeCallId: String,
        participatingCallId: String,
        participatingIdentityEpoch: UInt64?,
        currentIdentityEpoch: UInt64
    ) -> Bool {
        guard let participatingIdentityEpoch else { return false }
        return !activeCallId.isEmpty && activeCallId == participatingCallId &&
            participatingIdentityEpoch == currentIdentityEpoch
    }

    static func matchesTerminal(
        activeCallId: String,
        eventCallId: String,
        callIdentityEpoch: UInt64?,
        currentIdentityEpoch: UInt64
    ) -> Bool {
        guard let callIdentityEpoch else { return false }
        return !activeCallId.isEmpty && activeCallId == eventCallId &&
            callIdentityEpoch == currentIdentityEpoch
    }
}
