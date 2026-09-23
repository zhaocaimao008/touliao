package com.touliao.app.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import com.touliao.app.ui.theme.TouliaoLightPalette
import com.touliao.app.ui.theme.TouliaoDarkPalette
import org.junit.Assert.assertTrue
import org.junit.Test

class DesignContrastTest {
    private fun ratio(a: Color, b: Color): Float {
        val x = a.luminance(); val y = b.luminance()
        return (maxOf(x, y) + .05f) / (minOf(x, y) + .05f)
    }
    @Test fun textRemainsReadableAcrossThemesAndSelectedSurfaces() {
        for (p in listOf(TouliaoLightPalette, TouliaoDarkPalette)) {
            for (background in listOf(p.background, p.surface, p.surfaceSecondary, p.primarySoft)) {
                assertTrue("body text", ratio(p.text, background) >= 4.5f)
                assertTrue("secondary text", ratio(p.readableMuted, background) >= 4.5f)
            }
            assertTrue("primary button foreground", ratio(p.primaryForeground, p.primary) >= 4.5f)
            assertTrue("outgoing bubble foreground", ratio(p.messageOutgoingText, p.messageOutgoing) >= 4.5f)
            assertTrue("error recovery message", ratio(p.readableDanger, p.dangerSoft) >= 4.5f)
        }
    }
}
