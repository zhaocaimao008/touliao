package com.touliao.app.core.call

/** 最近处理过的 id（纯 Kotlin、线程安全）：按插入顺序最多保留 [max] 个，超出时淘汰最旧的；用于按 callId 去重 */
class RecentIds(private val max: Int) {
    init { require(max > 0) }

    private val ids = LinkedHashSet<String>()

    /** 记下 id；空串或已存在时返回 false */
    @Synchronized
    fun add(id: String): Boolean {
        if (id.isEmpty() || !ids.add(id)) return false
        // LinkedHashSet 按插入顺序迭代：迭代器第一个就是最旧的
        while (ids.size > max) {
            val oldest = ids.iterator()
            oldest.next()
            oldest.remove()
        }
        return true
    }

    @Synchronized
    operator fun contains(id: String): Boolean = id.isNotEmpty() && id in ids
}
