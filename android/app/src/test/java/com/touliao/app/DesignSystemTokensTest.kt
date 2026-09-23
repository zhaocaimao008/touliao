package com.touliao.app

import com.touliao.app.ui.theme.TouliaoMetrics
import org.junit.Assert.*
import org.junit.Test

class DesignSystemTokensTest {
    @Test fun nativeUnitsAndRoles() {
        assertEquals(16f, TouliaoMetrics.space4.value)
        assertEquals(120L, TouliaoMetrics.durationFast)
        assertEquals(48f, TouliaoMetrics.touchTarget.value)
        assertEquals(16f, TouliaoMetrics.fontBody.value)
        assertEquals(12f, TouliaoMetrics.fontCaption.value)
        assertTrue(TouliaoMetrics.layerNative > TouliaoMetrics.layerCall)
    }
}
