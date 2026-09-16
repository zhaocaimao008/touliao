import Foundation

protocol HistoryPageSource {
    func loadHistory(
        _ conversationId: String,
        before: Double?,
        beforeId: String?
    ) async throws -> [Message]
}

struct HistoryPaginationState {
    var messages: [Message]
    var loadingEarlier: Bool = false
    var reachedStart: Bool = false
}

@MainActor
struct HistoryPaginationAction {
    let source: HistoryPageSource
    let pageSize: Int

    init(source: HistoryPageSource, pageSize: Int = 50) {
        self.source = source
        self.pageSize = pageSize
    }

    func execute(
        conversationId: String,
        state: () -> HistoryPaginationState,
        isCurrentAttempt: () -> Bool,
        apply: (HistoryPaginationState) -> Void
    ) async {
        guard isCurrentAttempt() else { return }
        var current = state()
        guard !current.loadingEarlier, !current.reachedStart,
              let boundary = current.messages.first(where: { $0.localStatus == nil && !$0.id.isEmpty }) else { return }

        current.loadingEarlier = true
        apply(current)
        defer {
            if isCurrentAttempt() {
                var latest = state()
                latest.loadingEarlier = false
                apply(latest)
            }
        }

        guard let older = try? await source.loadHistory(
            conversationId,
            before: boundary.createdAt,
            beforeId: boundary.id
        ), isCurrentAttempt() else { return }
        current = state()
        let existing = Set(current.messages.map(\.id))
        current.messages = older.filter { !existing.contains($0.id) } + current.messages
        current.reachedStart = older.count < pageSize
        apply(current)
    }
}
