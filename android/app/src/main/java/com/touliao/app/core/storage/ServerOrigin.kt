package com.touliao.app.core.storage

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Scheme, canonical host and effective port; paths never confer credential ownership. */
fun normalizedOrigin(url: String): String? = url.trim().toHttpUrlOrNull()?.newBuilder()
    ?.username("")?.password("")?.encodedPath("/")?.query(null)?.fragment(null)
    ?.build()?.toString()?.trimEnd('/')
