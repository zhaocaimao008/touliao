package com.touliao.app.core.auth
import java.net.SocketTimeoutException
import java.io.IOException
import retrofit2.HttpException
internal enum class RestoreFailure(val message: String) {
    EXPIRED("登录已过期，请重新登录"), FORBIDDEN("账号访问被拒绝或已封禁，请联系管理员"), TIMEOUT("连接超时，正在重试"), OFFLINE("网络不可用，正在重试"), SERVER("服务暂时不可用，正在重试");
    companion object {
        fun from(error: Exception): RestoreFailure = when(error) {
            is HttpException -> when (error.code()) { 401 -> EXPIRED; 403 -> FORBIDDEN; else -> SERVER }
            is SocketTimeoutException -> TIMEOUT
            is IOException -> OFFLINE
            else -> SERVER
        }
    }
}

/** A stale restore never publishes success/failure or schedules another retry. */
internal suspend fun <T> restoreWithRetry(
    isCurrent: () -> Boolean,
    load: suspend () -> T,
    accept: (T) -> Unit,
    failure: (RestoreFailure) -> Unit,
    wait: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) },
) {
    var delayMs = 1_000L
    while (isCurrent()) {
        try {
            val result = load()
            if (isCurrent()) accept(result)
            return
        } catch (e: kotlinx.coroutines.CancellationException) { throw e }
        catch (e: Exception) {
            if (!isCurrent()) return
            val reason = RestoreFailure.from(e)
            failure(reason)
            if (reason == RestoreFailure.EXPIRED || reason == RestoreFailure.FORBIDDEN) return
        }
        if (!isCurrent()) return
        wait(delayMs)
        delayMs = (delayMs * 2).coerceAtMost(30_000L)
    }
}
