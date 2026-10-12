package com.touliao.app.core.auth
import java.net.SocketTimeoutException
import java.io.IOException
import retrofit2.HttpException
internal enum class RestoreFailure(val message: String) {
    EXPIRED("登录已过期，请重新登录"), FORBIDDEN("账号访问被拒绝或已封禁，请联系管理员"),
    // 2026-10-12：后端对「坏 token 反复重试」的 /me、/refresh 返回 429。此前 429 归入 SERVER
    // 无限退避重试（最多 30s 一次，永不停止），正是 401/429 风暴的来源之一。现在视为终止：停止轮询、
    // 回登录页一次；与 FORBIDDEN 一样保留本地凭据（429 本身不证明 token 失效），用户可直接重新登录。
    RATE_LIMITED("登录校验过于频繁，请稍后重新登录"),
    TIMEOUT("连接超时，正在重试"), OFFLINE("网络不可用，正在重试"), SERVER("服务暂时不可用，正在重试");
    /** 终止型失败：不再重试 /me。 */
    val terminal: Boolean get() = this == EXPIRED || this == FORBIDDEN || this == RATE_LIMITED
    companion object {
        fun from(error: Exception): RestoreFailure = when(error) {
            is HttpException -> when (error.code()) { 401 -> EXPIRED; 403 -> FORBIDDEN; 429 -> RATE_LIMITED; else -> SERVER }
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
            if (reason.terminal) return
        }
        if (!isCurrent()) return
        wait(delayMs)
        delayMs = (delayMs * 2).coerceAtMost(30_000L)
    }
}
