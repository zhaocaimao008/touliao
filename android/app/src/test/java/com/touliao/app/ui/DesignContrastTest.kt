package com.touliao.app.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import com.touliao.app.ui.theme.TouliaoLightPalette
import com.touliao.app.ui.theme.TouliaoDarkPalette
import com.touliao.app.ui.theme.touliaoColorScheme
import org.junit.Assert.assertEquals
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

    /** 红色角标（会话列表未读、重发感叹号、系统 Badge）：错误色上的文字在浅色/深色主题下都要 >= 4.5:1 */
    @Test fun errorBadgeTextIsReadableInBothThemes() {
        for ((p, dark) in listOf(TouliaoLightPalette to false, TouliaoDarkPalette to true)) {
            val scheme = touliaoColorScheme(p, dark)
            // 手写角标用 VxinError（= readableDanger）作底、colorScheme.onError 作字，两者必须是同一组颜色
            assertEquals("error color follows readableDanger (dark=$dark)", p.readableDanger, scheme.error)
            assertTrue("text on error badge (dark=$dark)", ratio(scheme.onError, scheme.error) >= 4.5f)
        }
    }
}
