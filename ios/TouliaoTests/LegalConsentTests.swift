import XCTest
@testable import Touliao

final class LegalConsentTests: XCTestCase {
    @MainActor func testValidFormsRequireExplicitAgreement() {
        let vm = AuthViewModel()
        vm.phone = "13000000000"; vm.password = "Testpass123"
        vm.username = "tester"; vm.inviteCode = "123456"
        XCTAssertFalse(vm.canLogin); XCTAssertFalse(vm.canRegister)
        vm.legalAccepted = true
        XCTAssertTrue(vm.canLogin); XCTAssertTrue(vm.canRegister)
        vm.legalAccepted = false
        XCTAssertFalse(vm.canLogin); XCTAssertFalse(vm.canRegister)
    }
    func testRequestsRecordBothVersionsWithoutImplicitAgreement() throws {
        let body = LoginBody(phone: "13000000000", password: "Testpass123", legalConsent: .current(accepted: true))
        let data = try JSONEncoder().encode(body)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let consent = try XCTUnwrap(json["legalConsent"] as? [String: Any])
        XCTAssertEqual(consent["accepted"] as? Bool, true)
        XCTAssertEqual(consent["privacyVersion"] as? String, LegalDocuments.version)
        XCTAssertEqual(consent["termsVersion"] as? String, LegalDocuments.version)
        let noChoice = try JSONEncoder().encode(LoginBody(phone: "x", password: "y"))
        XCTAssertFalse(String(decoding: noChoice, as: UTF8.self).contains("\"accepted\":true"))
    }
}
