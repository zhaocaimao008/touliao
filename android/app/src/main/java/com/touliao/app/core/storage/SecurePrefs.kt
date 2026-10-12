package com.touliao.app.core.storage

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * EncryptedSharedPreferences 统一创建入口（2026-10-12 启动性能）。
 *
 * 此前 TokenStore / AccountStore / MsgCacheStore 各自 `MasterKey.Builder(...).build()`，冷启动在主线程
 * 连做三次 Keystore 查询 + Tink keyset 初始化。现在 MasterKey 进程内只建一次；三个 Store 也都改为
 * 首次读写时才创建 prefs（by lazy），由 TouliaoApp 在后台线程预热，主线程首次访问时通常已就绪。
 */
internal object SecurePrefs {
    @Volatile private var masterKey: MasterKey? = null

    private fun masterKey(context: Context): MasterKey =
        masterKey ?: synchronized(this) {
            masterKey ?: MasterKey.Builder(context.applicationContext)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
                .also { masterKey = it }
        }

    /**
     * 所有 EncryptedSharedPreferences.create 串行执行（与 MasterKey 共用同一把锁）。
     * 改为懒创建后，预热线程 / AppScope（SessionManager→AccountStore）/ 主线程 / MsgCacheStore io
     * 线程可能同时创建不同文件；Tink keyset 读写与 AndroidKeystore 在部分实现上并发会抛瞬时异常，
     * 而 [createOrReset] 失败即删文件——瞬时竞态会变成静默登出。串行化后与改动前（主线程依次创建）等价。
     */
    fun create(context: Context, fileName: String): SharedPreferences = synchronized(this) {
        EncryptedSharedPreferences.create(
            context, fileName, masterKey(context),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /**
     * keyset 损坏的极少数情况：删掉重建，避免崩溃（与各 Store 原有兜底一致）。
     * 删除前先重试一次：Keystore 偶发的瞬时失败不应清掉 token / 账号列表。
     */
    fun createOrReset(context: Context, fileName: String): SharedPreferences = synchronized(this) {
        runCatching { create(context, fileName) }
            .recoverCatching { first ->
                Log.w(TAG, "创建 $fileName 失败，重试一次: ${first.javaClass.simpleName}")
                Thread.sleep(RETRY_DELAY_MS)
                create(context, fileName)
            }
            .getOrElse { e ->
                Log.e(TAG, "创建 $fileName 连续失败，按 keyset 损坏删除重建", e)
                context.deleteSharedPreferences(fileName)
                create(context, fileName)
            }
    }

    private const val TAG = "SecurePrefs"
    private const val RETRY_DELAY_MS = 100L
}
