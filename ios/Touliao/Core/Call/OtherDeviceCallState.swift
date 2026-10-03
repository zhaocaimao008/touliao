/// Tracks an outgoing call initiated by another device of the same account.
struct OtherDeviceCallState {
    private(set) var callId = ""
    private var identityEpoch: UInt64?

    mutating func began(callId: String, identityEpoch: UInt64) {
        guard !callId.isEmpty else { return }
        self.callId = callId
        self.identityEpoch = identityEpoch
    }

    mutating func ended(callId: String) {
        guard !callId.isEmpty, callId == self.callId else { return }
        self.callId = ""
        identityEpoch = nil
    }

    func isBusy(identityEpoch: UInt64) -> Bool {
        !callId.isEmpty && self.identityEpoch == identityEpoch
    }
}
