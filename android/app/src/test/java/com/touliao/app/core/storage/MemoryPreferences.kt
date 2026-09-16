package com.touliao.app.core.storage

import android.content.SharedPreferences
import java.lang.reflect.Proxy

// Android persistence boundary only; OutboxStore/TokenStore serialization and logic are real.
fun memoryPreferences(): SharedPreferences {
    val values = mutableMapOf<String, Any?>()
    lateinit var editor: SharedPreferences.Editor
    editor = Proxy.newProxyInstance(SharedPreferences.Editor::class.java.classLoader,
        arrayOf(SharedPreferences.Editor::class.java)) { _, method, args ->
        when (method.name) {
            "putString" -> { values[args!![0] as String] = args[1]; editor }
            "remove" -> { values.remove(args!![0]); editor }
            "clear" -> { values.clear(); editor }
            "commit" -> true
            "apply" -> null
            else -> error("Unexpected editor operation ${method.name}")
        }
    } as SharedPreferences.Editor
    return Proxy.newProxyInstance(SharedPreferences::class.java.classLoader,
        arrayOf(SharedPreferences::class.java)) { _, method, args ->
        when (method.name) {
            "getString" -> values[args!![0]] ?: args[1]
            "edit" -> editor
            "getAll" -> values.toMap()
            else -> error("Unexpected preferences operation ${method.name}")
        }
    } as SharedPreferences
}
