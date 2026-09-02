import Foundation

/// Correlates a realtime call signal with the currently active peer call.
/// Empty event call IDs are accepted only for compatibility with servers/clients
/// that predate call IDs. Mirrors android/.../core/call/CallSignalMatcher.kt exactly.
enum CallSignalMatcher {
    static func matches(activeCallId: String, eventCallId: String, activePeerId: String, eventPeerId: String) -> Bool {
        guard activePeerId == eventPeerId else { return false }
        return eventCallId.isEmpty || eventCallId == activeCallId
    }
}
