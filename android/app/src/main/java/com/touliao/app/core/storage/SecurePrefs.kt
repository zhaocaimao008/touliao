package com.touliao.app.core.storage

import android.content.Context
import android.content.SharedPreferences
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

    fun create(context: Context, fileName: String): SharedPreferences =
        EncryptedSharedPreferences.create(
            context, fileName, masterKey(context),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )

    /** keyset 损坏的极少数情况：删掉重建，避免崩溃（与各 Store 原有兜底一致）。 */
    fun createOrReset(context: Context, fileName: String): SharedPreferences =
        runCatching { create(context, fileName) }.getOrElse {
            context.deleteSharedPreferences(fileName)
            create(context, fileName)
        }
}
