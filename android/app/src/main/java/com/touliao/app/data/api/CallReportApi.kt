package com.touliao.app.data.api

import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST
import retrofit2.http.Path

interface CallReportApi {
    /**
     * 通话结束质量上报（需鉴权）。返回 Response 而非直接解析：旧后端没有该路由（404）时不抛异常，
     * 由调用方静默忽略。body 由 [com.touliao.app.core.call.buildCallReportJson] 生成（null 字段显式编码）。
     */
    @POST("api/calls/{callId}/report")
    suspend fun report(@Path("callId") callId: String, @Body body: RequestBody): Response<ResponseBody>
}
