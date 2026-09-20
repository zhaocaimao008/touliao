package com.touliao.app.core.realtime

/** A view belongs to one identity epoch. Invalidations fence pending GETs. */
class SocialReadGuard(private val identity: () -> Long, private val revision: () -> Long) {
    private val owner = identity()
    private var sequence = 0L
    data class Stamp(val sequence: Long, val revision: Long)
    fun begin(): Stamp? = if (identity() != owner) null else Stamp(++sequence, revision())
    fun current(stamp: Stamp): Boolean = identity() == owner && sequence == stamp.sequence && revision() == stamp.revision
}
