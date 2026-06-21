package com.vxin.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class DeviceTokenRequest(val token: String, val platform: String = "android")

@Serializable
data class DeleteTokenRequest(val token: String)
