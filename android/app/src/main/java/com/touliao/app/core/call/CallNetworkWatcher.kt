package com.touliao.app.core.call

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.util.Log

/**
 * 通话期间监听系统默认网络切换（Wi-Fi↔4G），切换后立即触发 ICE restart（2026-10-12）。
 * 此前只能等 ICE 自己报 disconnected 再 3s 防抖，用户感知是「切网后卡 5~10 秒」。
 *
 * 只在默认网络「换成了另一个」时回调：注册时系统会立刻对当前网络回调一次 onAvailable，忽略；
 * onLost 只记下「当前无网」，等新网络 onAvailable 再触发（无网时 restart 只会白白消耗重试次数）。
 * 回调发生在 ConnectivityThread，调用方须自行切线程。所有异常静默，绝不影响通话。
 */
internal class CallNetworkWatcher(private val context: Context, private val tag: String) {
    private var callback: ConnectivityManager.NetworkCallback? = null
    @Volatile private var current: Network? = null
    @Volatile private var primed = false

    @Synchronized
    fun start(onNetworkChanged: () -> Unit) {
        if (callback != null) return
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        current = null; primed = false
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                val prev = current
                current = network
                if (!primed) { primed = true; return }    // 注册时对当前网络的首次回调
                if (prev != network) {
                    Log.i(tag, "默认网络切换 → 立即 ICE restart")
                    runCatching { onNetworkChanged() }
                }
            }
            override fun onLost(network: Network) {
                primed = true
                if (current == network) current = null
            }
        }
        runCatching { cm.registerDefaultNetworkCallback(cb) }
            .onSuccess { callback = cb }
            .onFailure { Log.w(tag, "registerDefaultNetworkCallback 失败: ${it.message}") }
    }

    @Synchronized
    fun stop() {
        val cb = callback ?: return
        callback = null
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        runCatching { cm.unregisterNetworkCallback(cb) }
    }
}
