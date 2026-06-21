package com.vxin.app.core.network

import com.vxin.app.data.model.ApiErrorBody
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import java.io.IOException

private val errorJson = Json { ignoreUnknownKeys = true }

/** 把异常转成可直接展示给用户的中文提示，并尽量解析后端 { error } 文案。 */
fun Throwable.toUserMessage(default: String = "操作失败，请重试"): String = when (this) {
    is HttpException -> parseServerError() ?: when (code()) {
        401 -> "手机号或密码错误"
        403 -> "没有权限"
        429 -> "操作太频繁，请稍后再试"
        in 500..599 -> "服务器开小差了，请稍后再试"
        else -> "请求失败（${code()}）"
    }
    is IOException -> "网络异常，请检查网络连接"
    else -> default
}

private fun HttpException.parseServerError(): String? = runCatching {
    val raw = response()?.errorBody()?.string().orEmpty()
    if (raw.isBlank()) null else errorJson.decodeFromString<ApiErrorBody>(raw).error
}.getOrNull()
