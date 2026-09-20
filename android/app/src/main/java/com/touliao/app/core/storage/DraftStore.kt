package com.touliao.app.core.storage

import android.content.Context
import android.content.SharedPreferences
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

data class DraftOwner(val server: String, val accountId: String, val identityEpoch: Long, val generation: Long)

/** Text drafts only. Unowned legacy keys remain quarantined and are never imported. */
@Singleton
class DraftStore internal constructor(
    private val prefs: SharedPreferences,
    private val environment: (() -> Pair<String, Long>)? = null,
) {
    @Inject constructor(@ApplicationContext context: Context, tokens: TokenStore, server: ServerConfig) : this(
        context.getSharedPreferences("vxin_drafts", Context.MODE_PRIVATE),
        { server.baseUrl.trimEnd('/') to tokens.snapshot().identityEpoch },
    )
    private var generation = 0L
    private var active: DraftOwner? = null

    @Synchronized fun activate(server: String, accountId: String, identityEpoch: Long): DraftOwner {
        val normalized = server.trimEnd('/')
        active?.let { if (it.server == normalized && it.accountId == accountId && it.identityEpoch == identityEpoch) return it }
        return DraftOwner(normalized, accountId, identityEpoch, ++generation).also { active = it }
    }
    @Synchronized fun invalidate() { active = null; generation++ }
    @Synchronized fun capture(): DraftOwner? = active
    private fun current(owner: DraftOwner?, env: Pair<String, Long>?): Boolean = owner != null && owner == active &&
        owner.accountId.isNotBlank() && owner.server.isNotBlank() &&
        (env?.let { it.first == owner.server && it.second == owner.identityEpoch } ?: true)
    // Length-prefix encoding prevents separator collisions in server/account/conversation IDs.
    private fun key(owner: DraftOwner, conversationId: String) = "v2:" +
        listOf(owner.server, owner.accountId, conversationId).joinToString("") { "${it.length}:$it" }
    fun get(conversationId: String, owner: DraftOwner? = capture()): String {
        // Read the credential lock before the draft lock, matching SessionManager.
        val env = environment?.invoke()
        return synchronized(this) {
            if (conversationId.isBlank() || !current(owner, env)) ""
            else prefs.getString(key(owner!!, conversationId), "").orEmpty()
        }
    }
    fun set(conversationId: String, text: String, owner: DraftOwner?) {
        val env = environment?.invoke()
        synchronized(this) {
            if (conversationId.isBlank() || !current(owner, env)) return
            val key = key(owner!!, conversationId)
            prefs.edit().apply { if (text.isBlank()) remove(key) else putString(key, text) }.apply()
        }
    }
    fun clear(conversationId: String, owner: DraftOwner?) = set(conversationId, "", owner)
}
