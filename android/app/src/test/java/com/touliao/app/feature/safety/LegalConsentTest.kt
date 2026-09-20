package com.touliao.app.feature.safety

import com.touliao.app.data.model.LegalConsentData
import com.touliao.app.data.model.LoginRequest
import com.touliao.app.data.model.RegisterRequest
import com.touliao.app.feature.auth.LoginUiState
import com.touliao.app.feature.auth.RegisterUiState
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class LegalConsentTest {
    @Test fun validFormsRequireAnExplicitChoice() {
        val login = LoginUiState(phone = "13000000000", password = "Testpass123")
        val register = RegisterUiState(username = "tester", phone = "13000000000", password = "Testpass123", inviteCode = "123456")
        assertFalse(login.canSubmit); assertTrue(login.copy(legalAccepted = true).canSubmit)
        assertFalse(register.canSubmit); assertTrue(register.copy(legalAccepted = true).canSubmit)
    }
    @Test fun defaultJsonEncodingIncludesBothExplicitVersions() {
        val consent = LegalConsentData(true)
        for (json in listOf(Json.encodeToString(LoginRequest("13000000000", "Testpass123", legalConsent = consent)), Json.encodeToString(RegisterRequest("13000000000", "Testpass123", "tester", "123456", consent)))) {
            assertTrue(json.contains("\"accepted\":true"))
            assertTrue(json.contains("\"privacyVersion\":\"${LegalDocuments.version}\""))
            assertTrue(json.contains("\"termsVersion\":\"${LegalDocuments.version}\""))
        }
        assertFalse(Json.encodeToString(LoginRequest("x", "y")).contains("\"accepted\":true"))
    }
}
