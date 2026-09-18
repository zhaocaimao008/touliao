// Generated from the supplied SVG geometry; currentColor is supplied by Icon tint.
package com.touliao.app.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

object DesignIcons {
    private fun vector(name: String, vararg paths: String): ImageVector = ImageVector.Builder(
        name, 24.dp, 24.dp, 24f, 24f
    ).apply {
        paths.forEach { data -> addPath(
            pathData = PathParser().parsePathString(data).toNodes(),
            fill = null, stroke = SolidColor(Color.Black), strokeLineWidth = 1.8f,
            strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round,
        ) }
    }.build()
    val ArrowDownToLine: ImageVector by lazy { vector("arrow-down-to-line", "M12 17V3", "m6 11 6 6 6-6", "M19 21H5") }
    val ArrowDown: ImageVector by lazy { vector("arrow-down", "M12 5v14", "m19 12-7 7-7-7") }
    val ArrowLeft: ImageVector by lazy { vector("arrow-left", "m12 19-7-7 7-7", "M19 12H5") }
    val ArrowRight: ImageVector by lazy { vector("arrow-right", "M5 12h14", "m12 5 7 7-7 7") }
    val AtSign: ImageVector by lazy { vector("at-sign", "M8 12 A4 4 0 1 0 16 12 A4 4 0 1 0 8 12", "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8") }
    val Backpack: ImageVector by lazy { vector("backpack", "M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z", "M8 10h8", "M8 18h8", "M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6", "M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2") }
    val BadgeCheck: ImageVector by lazy { vector("badge-check", "M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z", "m9 12 2 2 4-4") }
    val BatteryFull: ImageVector by lazy { vector("battery-full", "M10 10v4", "M14 10v4", "M22 14v-4", "M6 10v4", "M4 6 H16 A2 2 0 0 1 18 8 V16 A2 2 0 0 1 16 18 H4 A2 2 0 0 1 2 16 V8 A2 2 0 0 1 4 6 Z") }
    val BellRing: ImageVector by lazy { vector("bell-ring", "M10.268 21a2 2 0 0 0 3.464 0", "M22 8c0-2.3-.8-4.3-2-6", "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326", "M4 2C2.8 3.7 2 5.7 2 8") }
    val Bell: ImageVector by lazy { vector("bell", "M10.268 21a2 2 0 0 0 3.464 0", "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326") }
    val Bookmark: ImageVector by lazy { vector("bookmark", "M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z") }
    val BrushCleaning: ImageVector by lazy { vector("brush-cleaning", "m16 22-1-4", "M19 14a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2h-3a1 1 0 0 1-1-1V4a2 2 0 0 0-4 0v5a1 1 0 0 1-1 1H6a2 2 0 0 0-2 2v1a1 1 0 0 0 1 1", "M19 14H5l-1.973 6.767A1 1 0 0 0 4 22h16a1 1 0 0 0 .973-1.233z", "m8 22 1-4") }
    val CalendarDays: ImageVector by lazy { vector("calendar-days", "M8 2v4", "M16 2v4", "M5 4 H19 A2 2 0 0 1 21 6 V20 A2 2 0 0 1 19 22 H5 A2 2 0 0 1 3 20 V6 A2 2 0 0 1 5 4 Z", "M3 10h18", "M8 14h.01", "M12 14h.01", "M16 14h.01", "M8 18h.01", "M12 18h.01", "M16 18h.01") }
    val Camera: ImageVector by lazy { vector("camera", "M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z", "M9 13 A3 3 0 1 0 15 13 A3 3 0 1 0 9 13") }
    val CheckCheck: ImageVector by lazy { vector("check-check", "M18 6 7 17l-5-5", "m22 10-7.5 7.5L13 16") }
    val Check: ImageVector by lazy { vector("check", "M20 6 9 17l-5-5") }
    val ChevronDown: ImageVector by lazy { vector("chevron-down", "m6 9 6 6 6-6") }
    val ChevronLeft: ImageVector by lazy { vector("chevron-left", "m15 18-6-6 6-6") }
    val ChevronRight: ImageVector by lazy { vector("chevron-right", "m9 18 6-6-6-6") }
    val ChevronsUp: ImageVector by lazy { vector("chevrons-up", "m17 11-5-5-5 5", "m17 18-5-5-5 5") }
    val CircleAlert: ImageVector by lazy { vector("circle-alert", "M2 12 A10 10 0 1 0 22 12 A10 10 0 1 0 2 12", "M12 8 L12 12", "M12 16 L12.01 16") }
    val CircleCheck: ImageVector by lazy { vector("circle-check", "M2 12 A10 10 0 1 0 22 12 A10 10 0 1 0 2 12", "m9 12 2 2 4-4") }
    val CircleHelp: ImageVector by lazy { vector("circle-help", "M2 12 A10 10 0 1 0 22 12 A10 10 0 1 0 2 12", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01") }
    val Clock3: ImageVector by lazy { vector("clock-3", "M2 12 A10 10 0 1 0 22 12 A10 10 0 1 0 2 12", "M12 6v6h4") }
    val Clock: ImageVector by lazy { vector("clock", "M2 12 A10 10 0 1 0 22 12 A10 10 0 1 0 2 12", "M12 6v6l4 2") }
    val Compass: ImageVector by lazy { vector("compass", "M2 12 A10 10 0 1 0 22 12 A10 10 0 1 0 2 12", "m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z") }
    val Component: ImageVector by lazy { vector("component", "M15.536 11.293a1 1 0 0 0 0 1.414l2.376 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z", "M2.297 11.293a1 1 0 0 0 0 1.414l2.377 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414L6.088 8.916a1 1 0 0 0-1.414 0z", "M8.916 17.912a1 1 0 0 0 0 1.415l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.415l-2.377-2.376a1 1 0 0 0-1.414 0z", "M8.916 4.674a1 1 0 0 0 0 1.414l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z") }
    val ContactRound: ImageVector by lazy { vector("contact-round", "M16 2v2", "M17.915 22a6 6 0 0 0-12 0", "M8 2v2", "M8 12 A4 4 0 1 0 16 12 A4 4 0 1 0 8 12", "M5 4 H19 A2 2 0 0 1 21 6 V20 A2 2 0 0 1 19 22 H5 A2 2 0 0 1 3 20 V6 A2 2 0 0 1 5 4 Z") }
    val Contact: ImageVector by lazy { vector("contact", "M16 2v2", "M7 22v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2", "M8 2v2", "M9 11 A3 3 0 1 0 15 11 A3 3 0 1 0 9 11", "M5 4 H19 A2 2 0 0 1 21 6 V20 A2 2 0 0 1 19 22 H5 A2 2 0 0 1 3 20 V6 A2 2 0 0 1 5 4 Z") }
    val Copy: ImageVector by lazy { vector("copy", "M10 8 H20 A2 2 0 0 1 22 10 V20 A2 2 0 0 1 20 22 H10 A2 2 0 0 1 8 20 V10 A2 2 0 0 1 10 8 Z", "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2") }
    val Delete: ImageVector by lazy { vector("delete", "M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z", "m12 9 6 6", "m18 9-6 6") }
    val Download: ImageVector by lazy { vector("download", "M12 15V3", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5") }
    val Ellipsis: ImageVector by lazy { vector("ellipsis", "M11 12 A1 1 0 1 0 13 12 A1 1 0 1 0 11 12", "M18 12 A1 1 0 1 0 20 12 A1 1 0 1 0 18 12", "M4 12 A1 1 0 1 0 6 12 A1 1 0 1 0 4 12") }
    val Expand: ImageVector by lazy { vector("expand", "m15 15 6 6", "m15 9 6-6", "M21 16v5h-5", "M21 8V3h-5", "M3 16v5h5", "m3 21 6-6", "M3 8V3h5", "M9 9 3 3") }
    val ExternalLink: ImageVector by lazy { vector("external-link", "M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6") }
    val EyeOff: ImageVector by lazy { vector("eye-off", "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49", "M14.084 14.158a3 3 0 0 1-4.242-4.242", "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143", "m2 2 20 20") }
    val Eye: ImageVector by lazy { vector("eye", "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0", "M9 12 A3 3 0 1 0 15 12 A3 3 0 1 0 9 12") }
    val FileText: ImageVector by lazy { vector("file-text", "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z", "M14 2v5a1 1 0 0 0 1 1h5", "M10 9H8", "M16 13H8", "M16 17H8") }
    val File: ImageVector by lazy { vector("file", "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z", "M14 2v5a1 1 0 0 0 1 1h5") }
    val Files: ImageVector by lazy { vector("files", "M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8", "M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z", "M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1") }
    val Filter: ImageVector by lazy { vector("filter", "M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z") }
    val Focus: ImageVector by lazy { vector("focus", "M9 12 A3 3 0 1 0 15 12 A3 3 0 1 0 9 12", "M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2") }
    val FolderOpen: ImageVector by lazy { vector("folder-open", "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2") }
    val Folder: ImageVector by lazy { vector("folder", "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z") }
    val Forward: ImageVector by lazy { vector("forward", "m15 17 5-5-5-5", "M4 18v-2a4 4 0 0 1 4-4h12") }
    val Ghost: ImageVector by lazy { vector("ghost", "M9 10h.01", "M15 10h.01", "M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z") }
    val Group: ImageVector by lazy { vector("group", "M3 7V5c0-1.1.9-2 2-2h2", "M17 3h2c1.1 0 2 .9 2 2v2", "M21 17v2c0 1.1-.9 2-2 2h-2", "M7 21H5c-1.1 0-2-.9-2-2v-2", "M8 7 H13 A1 1 0 0 1 14 8 V11 A1 1 0 0 1 13 12 H8 A1 1 0 0 1 7 11 V8 A1 1 0 0 1 8 7 Z", "M11 12 H16 A1 1 0 0 1 17 13 V16 A1 1 0 0 1 16 17 H11 A1 1 0 0 1 10 16 V13 A1 1 0 0 1 11 12 Z") }
    val HardDrive: ImageVector by lazy { vector("hard-drive", "M10 16h.01", "M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z", "M21.946 12.013H2.054", "M6 16h.01") }
    val Heart: ImageVector by lazy { vector("heart", "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5") }
    val Image: ImageVector by lazy { vector("image", "M5 3 H19 A2 2 0 0 1 21 5 V19 A2 2 0 0 1 19 21 H5 A2 2 0 0 1 3 19 V5 A2 2 0 0 1 5 3 Z", "M7 9 A2 2 0 1 0 11 9 A2 2 0 1 0 7 9", "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21") }
    val Images: ImageVector by lazy { vector("images", "m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16", "M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2", "M12 7 A1 1 0 1 0 14 7 A1 1 0 1 0 12 7", "M10 2 H20 A2 2 0 0 1 22 4 V14 A2 2 0 0 1 20 16 H10 A2 2 0 0 1 8 14 V4 A2 2 0 0 1 10 2 Z") }
    val Info: ImageVector by lazy { vector("info", "M2 12 A10 10 0 1 0 22 12 A10 10 0 1 0 2 12", "M12 16v-4", "M12 8h.01") }
    val KeyRound: ImageVector by lazy { vector("key-round", "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z", "M16 7.5 A0.5 0.5 0 1 0 17 7.5 A0.5 0.5 0 1 0 16 7.5") }
    val Laptop: ImageVector by lazy { vector("laptop", "M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z", "M20.054 15.987H3.946") }
    val Layers: ImageVector by lazy { vector("layers", "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z", "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12", "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17") }
    val Leaf: ImageVector by lazy { vector("leaf", "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z", "M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12") }
    val Link: ImageVector by lazy { vector("link", "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71") }
    val LockKeyhole: ImageVector by lazy { vector("lock-keyhole", "M11 16 A1 1 0 1 0 13 16 A1 1 0 1 0 11 16", "M5 10 H19 A2 2 0 0 1 21 12 V20 A2 2 0 0 1 19 22 H5 A2 2 0 0 1 3 20 V12 A2 2 0 0 1 5 10 Z", "M7 10V7a5 5 0 0 1 10 0v3") }
    val LogOut: ImageVector by lazy { vector("log-out", "m16 17 5-5-5-5", "M21 12H9", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4") }
    val Mail: ImageVector by lazy { vector("mail", "m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7", "M4 4 H20 A2 2 0 0 1 22 6 V18 A2 2 0 0 1 20 20 H4 A2 2 0 0 1 2 18 V6 A2 2 0 0 1 4 4 Z") }
    val MapPin: ImageVector by lazy { vector("map-pin", "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0", "M9 10 A3 3 0 1 0 15 10 A3 3 0 1 0 9 10") }
    val Megaphone: ImageVector by lazy { vector("megaphone", "M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z", "M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14", "M8 6v8") }
    val MessageCircle: ImageVector by lazy { vector("message-circle", "M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719") }
    val MessageSquare: ImageVector by lazy { vector("message-square", "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z") }
    val MessagesSquare: ImageVector by lazy { vector("messages-square", "M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z", "M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1") }
    val Mic: ImageVector by lazy { vector("mic", "M12 19v3", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 2 H12 A3 3 0 0 1 15 5 V12 A3 3 0 0 1 12 15 H12 A3 3 0 0 1 9 12 V5 A3 3 0 0 1 12 2 Z") }
    val Minus: ImageVector by lazy { vector("minus", "M5 12h14") }
    val MonitorSmartphone: ImageVector by lazy { vector("monitor-smartphone", "M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8", "M10 19v-3.96 3.15", "M7 19h5", "M18 12 H20 A2 2 0 0 1 22 14 V20 A2 2 0 0 1 20 22 H18 A2 2 0 0 1 16 20 V14 A2 2 0 0 1 18 12 Z") }
    val Monitor: ImageVector by lazy { vector("monitor", "M4 3 H20 A2 2 0 0 1 22 5 V15 A2 2 0 0 1 20 17 H4 A2 2 0 0 1 2 15 V5 A2 2 0 0 1 4 3 Z", "M8 21 L16 21", "M12 17 L12 21") }
    val Moon: ImageVector by lazy { vector("moon", "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401") }
    val MoreHorizontal: ImageVector by lazy { vector("more-horizontal", "M11 12 A1 1 0 1 0 13 12 A1 1 0 1 0 11 12", "M18 12 A1 1 0 1 0 20 12 A1 1 0 1 0 18 12", "M4 12 A1 1 0 1 0 6 12 A1 1 0 1 0 4 12") }
    val MountainSnow: ImageVector by lazy { vector("mountain-snow", "m8 3 4 8 5-5 5 15H2L8 3z", "M4.14 15.08c2.62-1.57 5.24-1.43 7.86.42 2.74 1.94 5.49 2 8.23.19") }
    val Navigation: ImageVector by lazy { vector("navigation", "M3 11 22 2 13 21 11 13 3 11 Z") }
    val Palette: ImageVector by lazy { vector("palette", "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z", "M13 6.5 A0.5 0.5 0 1 0 14 6.5 A0.5 0.5 0 1 0 13 6.5", "M17 10.5 A0.5 0.5 0 1 0 18 10.5 A0.5 0.5 0 1 0 17 10.5", "M6 12.5 A0.5 0.5 0 1 0 7 12.5 A0.5 0.5 0 1 0 6 12.5", "M8 7.5 A0.5 0.5 0 1 0 9 7.5 A0.5 0.5 0 1 0 8 7.5") }
    val PanelTop: ImageVector by lazy { vector("panel-top", "M5 3 H19 A2 2 0 0 1 21 5 V19 A2 2 0 0 1 19 21 H5 A2 2 0 0 1 3 19 V5 A2 2 0 0 1 5 3 Z", "M3 9h18") }
    val PanelsTopLeft: ImageVector by lazy { vector("panels-top-left", "M5 3 H19 A2 2 0 0 1 21 5 V19 A2 2 0 0 1 19 21 H5 A2 2 0 0 1 3 19 V5 A2 2 0 0 1 5 3 Z", "M3 9h18", "M9 21V9") }
    val Paperclip: ImageVector by lazy { vector("paperclip", "m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551") }
    val Pause: ImageVector by lazy { vector("pause", "M15 3 H18 A1 1 0 0 1 19 4 V20 A1 1 0 0 1 18 21 H15 A1 1 0 0 1 14 20 V4 A1 1 0 0 1 15 3 Z", "M6 3 H9 A1 1 0 0 1 10 4 V20 A1 1 0 0 1 9 21 H6 A1 1 0 0 1 5 20 V4 A1 1 0 0 1 6 3 Z") }
    val Pencil: ImageVector by lazy { vector("pencil", "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z", "m15 5 4 4") }
    val PhoneCall: ImageVector by lazy { vector("phone-call", "M13 2a9 9 0 0 1 9 9", "M13 6a5 5 0 0 1 5 5", "M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384") }
    val PhoneIncoming: ImageVector by lazy { vector("phone-incoming", "M16 2v6h6", "m22 2-6 6", "M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384") }
    val PhoneMissed: ImageVector by lazy { vector("phone-missed", "m16 2 6 6", "m22 2-6 6", "M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384") }
    val PhoneOff: ImageVector by lazy { vector("phone-off", "M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272", "M22 2 2 22", "M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473") }
    val PhoneOutgoing: ImageVector by lazy { vector("phone-outgoing", "m16 8 6-6", "M22 8V2h-6", "M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384") }
    val Phone: ImageVector by lazy { vector("phone", "M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384") }
    val Pin: ImageVector by lazy { vector("pin", "M12 17v5", "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z") }
    val Play: ImageVector by lazy { vector("play", "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z") }
    val Plus: ImageVector by lazy { vector("plus", "M5 12h14", "M12 5v14") }
    val QrCode: ImageVector by lazy { vector("qr-code", "M4 3 H7 A1 1 0 0 1 8 4 V7 A1 1 0 0 1 7 8 H4 A1 1 0 0 1 3 7 V4 A1 1 0 0 1 4 3 Z", "M17 3 H20 A1 1 0 0 1 21 4 V7 A1 1 0 0 1 20 8 H17 A1 1 0 0 1 16 7 V4 A1 1 0 0 1 17 3 Z", "M4 16 H7 A1 1 0 0 1 8 17 V20 A1 1 0 0 1 7 21 H4 A1 1 0 0 1 3 20 V17 A1 1 0 0 1 4 16 Z", "M21 16h-3a2 2 0 0 0-2 2v3", "M21 21v.01", "M12 7v3a2 2 0 0 1-2 2H7", "M3 12h.01", "M12 3h.01", "M12 16v.01", "M16 12h1", "M21 12v.01", "M12 21v-1") }
    val Quote: ImageVector by lazy { vector("quote", "M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z", "M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z") }
    val Radio: ImageVector by lazy { vector("radio", "M16.247 7.761a6 6 0 0 1 0 8.478", "M19.075 4.933a10 10 0 0 1 0 14.134", "M4.925 19.067a10 10 0 0 1 0-14.134", "M7.753 16.239a6 6 0 0 1 0-8.478", "M10 12 A2 2 0 1 0 14 12 A2 2 0 1 0 10 12") }
    val RefreshCw: ImageVector by lazy { vector("refresh-cw", "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5") }
    val Reply: ImageVector by lazy { vector("reply", "M20 18v-2a4 4 0 0 0-4-4H4", "m9 17-5-5 5-5") }
    val Rose: ImageVector by lazy { vector("rose", "M17 10h-1a4 4 0 1 1 4-4v.534", "M17 6h1a4 4 0 0 1 1.42 7.74l-2.29.87a6 6 0 0 1-5.339-10.68l2.069-1.31", "M4.5 17c2.8-.5 4.4 0 5.5.8s1.8 2.2 2.3 3.7c-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2", "M9.77 12C4 15 2 22 2 22", "M15 8 A2 2 0 1 0 19 8 A2 2 0 1 0 15 8") }
    val RotateCw: ImageVector by lazy { vector("rotate-cw", "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", "M21 3v5h-5") }
    val ScanLine: ImageVector by lazy { vector("scan-line", "M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2", "M7 12h10") }
    val Scissors: ImageVector by lazy { vector("scissors", "M3 6 A3 3 0 1 0 9 6 A3 3 0 1 0 3 6", "M8.12 8.12 12 12", "M20 4 8.12 15.88", "M3 18 A3 3 0 1 0 9 18 A3 3 0 1 0 3 18", "M14.8 14.8 20 20") }
    val ScreenShare: ImageVector by lazy { vector("screen-share", "M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3", "M8 21h8", "M12 17v4", "m17 8 5-5", "M17 3h5v5") }
    val SearchX: ImageVector by lazy { vector("search-x", "m13.5 8.5-5 5", "m8.5 8.5 5 5", "M3 11 A8 8 0 1 0 19 11 A8 8 0 1 0 3 11", "m21 21-4.3-4.3") }
    val Search: ImageVector by lazy { vector("search", "m21 21-4.34-4.34", "M3 11 A8 8 0 1 0 19 11 A8 8 0 1 0 3 11") }
    val Send: ImageVector by lazy { vector("send", "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z", "m21.854 2.147-10.94 10.939") }
    val Settings2: ImageVector by lazy { vector("settings-2", "M14 17H5", "M19 7h-9", "M14 17 A3 3 0 1 0 20 17 A3 3 0 1 0 14 17", "M4 7 A3 3 0 1 0 10 7 A3 3 0 1 0 4 7") }
    val Settings: ImageVector by lazy { vector("settings", "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915", "M9 12 A3 3 0 1 0 15 12 A3 3 0 1 0 9 12") }
    val Share2: ImageVector by lazy { vector("share-2", "M15 5 A3 3 0 1 0 21 5 A3 3 0 1 0 15 5", "M3 12 A3 3 0 1 0 9 12 A3 3 0 1 0 3 12", "M15 19 A3 3 0 1 0 21 19 A3 3 0 1 0 15 19", "M8.59 13.51 L15.42 17.49", "M15.41 6.51 L8.59 10.49") }
    val ShieldAlert: ImageVector by lazy { vector("shield-alert", "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z", "M12 8v4", "M12 16h.01") }
    val ShieldBan: ImageVector by lazy { vector("shield-ban", "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z", "m4.243 5.21 14.39 12.472") }
    val ShieldCheck: ImageVector by lazy { vector("shield-check", "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z", "m9 12 2 2 4-4") }
    val Shield: ImageVector by lazy { vector("shield", "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z") }
    val Signal: ImageVector by lazy { vector("signal", "M2 20h.01", "M7 20v-4", "M12 20v-8", "M17 20V8", "M22 4v16") }
    val SlidersHorizontal: ImageVector by lazy { vector("sliders-horizontal", "M10 5H3", "M12 19H3", "M14 3v4", "M16 17v4", "M21 12h-9", "M21 19h-5", "M21 5h-7", "M8 10v4", "M8 12H3") }
    val Smartphone: ImageVector by lazy { vector("smartphone", "M7 2 H17 A2 2 0 0 1 19 4 V20 A2 2 0 0 1 17 22 H7 A2 2 0 0 1 5 20 V4 A2 2 0 0 1 7 2 Z", "M12 18h.01") }
    val SmilePlus: ImageVector by lazy { vector("smile-plus", "M22 11v1a10 10 0 1 1-9-10", "M8 14s1.5 2 4 2 4-2 4-2", "M9 9 L9.01 9", "M15 9 L15.01 9", "M16 5h6", "M19 2v6") }
    val Smile: ImageVector by lazy { vector("smile", "M2 12 A10 10 0 1 0 22 12 A10 10 0 1 0 2 12", "M8 14s1.5 2 4 2 4-2 4-2", "M9 9 L9.01 9", "M15 9 L15.01 9") }
    val Sparkles: ImageVector by lazy { vector("sparkles", "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z", "M20 2v4", "M22 4h-4", "M2 20 A2 2 0 1 0 6 20 A2 2 0 1 0 2 20") }
    val SquarePen: ImageVector by lazy { vector("square-pen", "M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7", "M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z") }
    val Star: ImageVector by lazy { vector("star", "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z") }
    val Sun: ImageVector by lazy { vector("sun", "M8 12 A4 4 0 1 0 16 12 A4 4 0 1 0 8 12", "M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41", "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41") }
    val SwitchCamera: ImageVector by lazy { vector("switch-camera", "M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5", "M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5", "M9 12 A3 3 0 1 0 15 12 A3 3 0 1 0 9 12", "m18 22-3-3 3-3", "m6 2 3 3-3 3") }
    val Tag: ImageVector by lazy { vector("tag", "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z", "M7 7.5 A0.5 0.5 0 1 0 8 7.5 A0.5 0.5 0 1 0 7 7.5") }
    val Tags: ImageVector by lazy { vector("tags", "M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1z", "M2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193", "M10 6.5 A0.5 0.5 0 1 0 11 6.5 A0.5 0.5 0 1 0 10 6.5") }
    val Text: ImageVector by lazy { vector("text", "M21 5H3", "M15 12H3", "M17 19H3") }
    val Trash2: ImageVector by lazy { vector("trash-2", "M10 11v6", "M14 11v6", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M3 6h18", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2") }
    val TriangleAlert: ImageVector by lazy { vector("triangle-alert", "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01") }
    val Undo2: ImageVector by lazy { vector("undo-2", "M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11") }
    val UserPlus: ImageVector by lazy { vector("user-plus", "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M5 7 A4 4 0 1 0 13 7 A4 4 0 1 0 5 7", "M19 8 L19 14", "M22 11 L16 11") }
    val UserRoundPlus: ImageVector by lazy { vector("user-round-plus", "M2 21a8 8 0 0 1 13.292-6", "M5 8 A5 5 0 1 0 15 8 A5 5 0 1 0 5 8", "M19 16v6", "M22 19h-6") }
    val UserRoundX: ImageVector by lazy { vector("user-round-x", "M2 21a8 8 0 0 1 11.873-7", "M5 8 A5 5 0 1 0 15 8 A5 5 0 1 0 5 8", "m17 17 5 5", "m22 17-5 5") }
    val UserRound: ImageVector by lazy { vector("user-round", "M7 8 A5 5 0 1 0 17 8 A5 5 0 1 0 7 8", "M20 21a8 8 0 0 0-16 0") }
    val User: ImageVector by lazy { vector("user", "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", "M8 7 A4 4 0 1 0 16 7 A4 4 0 1 0 8 7") }
    val Users: ImageVector by lazy { vector("users", "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M16 3.128a4 4 0 0 1 0 7.744", "M22 21v-2a4 4 0 0 0-3-3.87", "M5 7 A4 4 0 1 0 13 7 A4 4 0 1 0 5 7") }
    val Video: ImageVector by lazy { vector("video", "m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5", "M4 6 H14 A2 2 0 0 1 16 8 V16 A2 2 0 0 1 14 18 H4 A2 2 0 0 1 2 16 V8 A2 2 0 0 1 4 6 Z") }
    val View: ImageVector by lazy { vector("view", "M21 17v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2", "M21 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2", "M11 12 A1 1 0 1 0 13 12 A1 1 0 1 0 11 12", "M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0") }
    val Volume2: ImageVector by lazy { vector("volume-2", "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z", "M16 9a5 5 0 0 1 0 6", "M19.364 18.364a9 9 0 0 0 0-12.728") }
    val WifiOff: ImageVector by lazy { vector("wifi-off", "M12 20h.01", "M8.5 16.429a5 5 0 0 1 7 0", "M5 12.859a10 10 0 0 1 5.17-2.69", "M19 12.859a10 10 0 0 0-2.007-1.523", "M2 8.82a15 15 0 0 1 4.177-2.643", "M22 8.82a15 15 0 0 0-11.288-3.764", "m2 2 20 20") }
    val Wifi: ImageVector by lazy { vector("wifi", "M12 20h.01", "M2 8.82a15 15 0 0 1 20 0", "M5 12.859a10 10 0 0 1 14 0", "M8.5 16.429a5 5 0 0 1 7 0") }
    val X: ImageVector by lazy { vector("x", "M18 6 6 18", "m6 6 12 12") }
}
