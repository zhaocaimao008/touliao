package com.vxin.app.data.api

import com.vxin.app.data.model.DeleteTokenRequest
import com.vxin.app.data.model.DeviceTokenRequest
import retrofit2.http.Body
import retrofit2.http.HTTP
import retrofit2.http.POST

interface NotificationApi {

    /** 注册 FCM 设备 token */
    @POST("api/notifications/device-token")
    suspend fun registerToken(@Body body: DeviceTokenRequest)

    /** 注销设备 token（登出时）。DELETE 带 body，用 @HTTP 显式声明 */
    @HTTP(method = "DELETE", path = "api/notifications/device-token", hasBody = true)
    suspend fun deleteToken(@Body body: DeleteTokenRequest)
}
