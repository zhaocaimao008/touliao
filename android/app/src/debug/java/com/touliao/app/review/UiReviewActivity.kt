package com.touliao.app.review

import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import android.os.Bundle
import dagger.hilt.android.AndroidEntryPoint

/** Test host only: absent from release builds, never a launcher activity. */
@AndroidEntryPoint
class UiReviewActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
    }
}
