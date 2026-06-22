import Foundation

final class FavoritesRepository {
    static let shared = FavoritesRepository()
    private init() {}

    private let api = APIClient.shared

    func list() async throws -> [Collection] {
        try await api.send("api/users/me/collections")
    }

    func remove(_ id: String) async throws {
        let _: EmptyResponse = try await api.send("api/users/me/collections/\(id)", method: "DELETE")
    }
}
