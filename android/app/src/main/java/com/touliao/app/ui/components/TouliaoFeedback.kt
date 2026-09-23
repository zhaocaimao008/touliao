package com.touliao.app.ui.components

import android.content.Context
import android.widget.Toast

enum class FeedbackKind { NEUTRAL, SUCCESS, ERROR, WARNING }

/** Keep Android's native announcement/timeout handling. Native Toast has only
 * SHORT/LONG, so the shared readable-duration policy maps to LONG. No custom
 * overlay replaces system accessibility or intercepts input.
 */
object TouliaoFeedback {
    fun show(context: Context, text: CharSequence, kind: FeedbackKind = FeedbackKind.NEUTRAL) {
        // All kinds have the same native surface; textual semantics stay intact.
        when (kind) {
            FeedbackKind.NEUTRAL, FeedbackKind.SUCCESS, FeedbackKind.ERROR, FeedbackKind.WARNING ->
                Toast.makeText(context, text, Toast.LENGTH_LONG).show()
        }
    }
}
