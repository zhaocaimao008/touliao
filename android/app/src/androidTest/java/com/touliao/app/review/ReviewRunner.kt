package com.touliao.app.review

import android.app.Application
import android.content.Context
import androidx.test.runner.AndroidJUnitRunner
import dagger.hilt.android.testing.HiltTestApplication

/** Skips real push / app startup for the isolated native review process. */
class ReviewRunner : AndroidJUnitRunner() {
    override fun newApplication(loader: ClassLoader, name: String, context: Context): Application =
        super.newApplication(loader, HiltTestApplication::class.java.name, context)
}
