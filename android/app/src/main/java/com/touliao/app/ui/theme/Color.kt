package com.touliao.app.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable

// Compatibility names keep business views intact; colors now follow the app theme.
val VxinBrand: Color
    @Composable @ReadOnlyComposable get() = LocalTouliaoPalette.current.primary
val VxinBrandLight: Color
    @Composable @ReadOnlyComposable get() = LocalTouliaoPalette.current.primary
val VxinBrandDark: Color
    @Composable @ReadOnlyComposable get() = LocalTouliaoPalette.current.primaryActive
val VxinBrandMuted: Color
    @Composable @ReadOnlyComposable get() = LocalTouliaoPalette.current.primarySoft
val VxinTeal: Color
    @Composable @ReadOnlyComposable get() = LocalTouliaoPalette.current.success
val VxinGreen: Color
    @Composable @ReadOnlyComposable get() = LocalTouliaoPalette.current.success
val VxinGreenDark: Color
    @Composable @ReadOnlyComposable get() = LocalTouliaoPalette.current.success
val VxinBg: Color
    @Composable @ReadOnlyComposable get() = LocalTouliaoPalette.current.background
val VxinTextPrimary: Color
    @Composable @ReadOnlyComposable get() = LocalTouliaoPalette.current.text
val VxinTextSecondary: Color
    @Composable @ReadOnlyComposable get() = LocalTouliaoPalette.current.readableMuted
val VxinError: Color
    @Composable @ReadOnlyComposable get() = LocalTouliaoPalette.current.readableDanger
val VxinSuccess: Color
    @Composable @ReadOnlyComposable get() = LocalTouliaoPalette.current.success
val VxinSuccessDark: Color
    @Composable @ReadOnlyComposable get() = LocalTouliaoPalette.current.success
val VxinBubbleMine: Color
    @Composable @ReadOnlyComposable get() = LocalTouliaoPalette.current.messageOutgoing
val VxinBubbleMineText: Color
    @Composable @ReadOnlyComposable get() = LocalTouliaoPalette.current.messageOutgoingText
val VxinBubbleText: Color
    @Composable @ReadOnlyComposable get() = LocalTouliaoPalette.current.text

// Explicit dark aliases and financial card colors retain their semantic purpose.
val VxinBubbleOtherDark = TouliaoDarkPalette.messageIncoming
val VxinBubbleTextDark = TouliaoDarkPalette.text
val VxinBgDark = TouliaoDarkPalette.background
val VxinSurfaceDark = TouliaoDarkPalette.surface
val VxinTextPrimaryDark = TouliaoDarkPalette.text
val VxinTextSecondaryDark = TouliaoDarkPalette.readableMuted
val VxinPay = Color(0xFF07C160)
val VxinPayDark = Color(0xFF059C4B)
val VxinPayGradStart = Color(0xFF09BB07)
val VxinPayGradEnd = Color(0xFF07C160)
