package com.touliao.app.feature.chat

import com.touliao.app.BuildConfig
import com.touliao.app.data.model.ConversationEvent
import com.touliao.app.data.model.Message

/**
 * 消息合并纯函数集 —— 无 Android SDK 依赖，JVM 单测可直跑。
 *
 * 2026-09-02 从 ChatViewModel 抽取（第 1 步纯抽取，行为不变，红灯锁定洞 A/B），
 * 随后分步修复，对齐 Web messageSync.js 已验证方案：
 *   洞 A（透明锚点）：pending 不参与二分比较（seqOf → null，lowerBoundSeq 跳过），
 *       真实消息恒有序；合并时服务端保持原序、pending 统一排末尾（created_at 升序）。
 *   洞 B（就地更新重定位）：替换/更新后相邻 seq 校验（violatesOrder），错位则取出
 *       按新 seq 重插。
 *   debug 有序断言：BuildConfig.DEBUG 编译期常量，release 折叠不执行（对齐 Web dev 断言）。
 *
 * pending 判定：localStatus != null（sending/failed 本地态）或 server_sequence <= 0。
 * 注意：本文件为纯 Kotlin，不依赖 Android 运行时（System.err 打断言日志，单测可跑）。
 */

/** 真实 seq：pending → null（透明锚点），真实消息 → Long */
private fun seqOf(m: Message): Long? =
    if (m.localStatus != null || m.server_sequence <= 0) null else m.server_sequence

/**
 * 第一个真实消息（seq 非 null）中 server_sequence >= target 的物理下标；无 → 数组末尾。
 * 线性 O(n)：数组物理上可能被 pending 打洞、无法直接二分；n 与既有 removeAll/indexOfFirst
 * 同阶，sync 属低频路径（重连/恢复/补拉），量级可接受（对齐 Web lowerBoundSeq）。
 */
private fun lowerBoundSeq(arr: List<Message>, target: Long): Int {
    for (i in arr.indices) {
        val s = seqOf(arr[i]) ?: continue
        if (s >= target) return i
    }
    return arr.size
}

/**
 * 服务端历史消息 + 本地待发(pending)合并。
 * 洞 A 修复：不再 `(server + pending).sortedBy { it.created_at }` 混排 —— pending 的
 * created_at 是客户端时钟、与服务端时间不可比，混排会把 pending 锚进数组中间（洞 A 源头）。
 * 现语义：服务端消息保持原序（即 seq 序），pending 统一排末尾、多条间按 created_at 升序
 * （同一客户端内时钟自洽 = 原发送先后，early first）。
 */
fun mergeServerWithPending(server: List<Message>, pending: List<Message>): List<Message> =
    server + pending.sortedBy { it.created_at }

/**
 * 按 server_sequence 有序插入（洞 A 修复：pending 透明，不参与比较、槽位不被挤走）。
 * 供 ChatViewModel 广播归位与洞 B 重插共用；applySyncEvents 内联同款 lowerBound。
 */
fun insertBySeq(messages: List<Message>, msg: Message): List<Message> {
    val current = messages.toMutableList()
    val seq = seqOf(msg)
    if (seq == null) { current.add(msg); return current }   // 防御：事件消息理论必有 seq
    if (BuildConfig.DEBUG) assertSortedOrRepair(current)    // debug 有序断言；release 常量折叠不执行
    current.add(lowerBoundSeq(current, seq), msg)
    return current
}

/**
 * 批量应用 sync 事件（复刻 ChatViewModel.catchUp 语义）：
 *   1. 事件按 server_sequence 升序处理
 *   2. message_created：先按 client_msg_id 删除乐观占位（让位给真实消息，避免双显），
 *      同 id 已存在则就地更新，否则按 seq 有序插入（洞 A 已修；就地更新后的
 *      洞 B 相邻校验在第 2 步接线）
 *   3. message_edited：同 id 就地 copy 更新（编辑不改 seq，位置不变）
 *   4. recalled/deleted/vanished：按 id 移除
 */
fun applySyncEvents(messages: List<Message>, events: List<ConversationEvent>): List<Message> {
    val current = messages.toMutableList()
    events.sortedBy { it.server_sequence }.forEach { event ->
        when (event.event_type) {
            "message_created" -> {
                val msg = event.message ?: return@forEach
                // 乐观占位替换：client_msg_id 命中的本地消息删除（让位给真实消息）
                msg.clientMsgId?.let { cid ->
                    current.removeAll { it.clientMsgId == cid || it.id == cid }
                }
                val idx = current.indexOfFirst { it.id == msg.id }
                if (idx >= 0) {
                    current[idx] = msg   // 已有：就地更新（如重发确认）
                    // 洞 B：更新后相邻 seq 校验——历史错位(洞 A 时期/旧 outbox pending
                    // 重发成功)卡在错误槽位的消息此处自愈：取出后按新 seq 重插。
                    if (violatesOrder(current, idx)) {
                        val moved = current.removeAt(idx)
                        val movedSeq = seqOf(moved)
                        if (movedSeq == null) current.add(moved)   // 防御：与相邻分支一致，null 时保持追加而非崩溃
                        else current.add(lowerBoundSeq(current, movedSeq), moved)
                    }
                } else {
                    // 新消息：按 server_sequence 有序插入（洞 A：lowerBound 跳过 pending）
                    val seq = seqOf(msg)
                    if (seq == null) current.add(msg)   // 防御：无 seq 的本地消息保持位置
                    else current.add(lowerBoundSeq(current, seq), msg)
                }
            }
            "message_edited" -> current.indexOfFirst { it.id == event.message_id }
                .takeIf { it >= 0 }?.let { i ->
                    current[i] = current[i].copy(
                        content = event.payload["content"] ?: current[i].content, edited = 1
                    )
                }
            "message_recalled", "message_deleted_for_me", "message_vanished" ->
                current.removeAll { it.id == event.message_id }
        }
    }
    return current
}

/**
 * 广播消息落地（复刻 ChatViewModel.claimOrAppend 语义，去 outbox 副作用）：
 *   若它是本端某条乐观气泡的回声（client_msg_id 认领）→ 替换那条乐观气泡并去重，
 *   随后相邻 seq 校验（洞 B）：pending 若曾被锚在中间/错槽，确认消息带新 seq
 *   停错槽位则取出按新 seq 重插（自愈）；否则按 id 去重后追加。
 */
fun claimOrAppend(messages: List<Message>, msg: Message): List<Message> {
    val cid = msg.clientMsgId
    if (cid != null) {
        val idx = messages.indexOfFirst { it.clientMsgId == cid || it.id == cid }
        if (idx >= 0) {
            // 若真实消息已因其它路径存在，避免重复（保留命中位置，删除其它同 id）
            val deduped = messages.filterIndexed { i, m -> i == idx || m.id != msg.id }
            val replaced = deduped.map { if (it.clientMsgId == cid || it.id == cid) msg else it }
            // 洞 B：替换后相邻 seq 校验，错位则取出按新 seq 重插
            val at = replaced.indexOfFirst { it.id == msg.id }
            if (at >= 0 && violatesOrder(replaced, at)) {
                val moved = replaced.toMutableList().apply { removeAt(at) }
                return insertBySeq(moved, msg)
            }
            return replaced
        }
    }
    return if (messages.any { it.id == msg.id }) messages else messages + msg
}

/**
 * 相邻序校验（洞 B，对齐 Web violatesOrder）：arr[i] 与最近的真实邻居逆序 → true。
 * O(1)（pending 数极少）。正确性依据：server_sequence 在会话内 UNIQUE，
 * 任何全局错位必存在相邻逆序对 → 只查最近邻居即可检出，无需整段扫描。
 * 忽略 pending（不参与比较）。
 */
fun violatesOrder(messages: List<Message>, i: Int): Boolean {
    val seq = seqOf(messages[i]) ?: return false
    var l = i - 1
    while (l >= 0 && seqOf(messages[l]) == null) l--
    if (l >= 0 && (seqOf(messages[l]) ?: Long.MAX_VALUE) > seq) return true
    var r = i + 1
    while (r < messages.size && seqOf(messages[r]) == null) r++
    if (r < messages.size && (seqOf(messages[r]) ?: Long.MIN_VALUE) < seq) return true
    return false
}

/**
 * debug 有序断言（对齐 Web assertSortedOrRepair）：插入前校验真实消息 seq 单调；
 * 违序 → 打印 + 降级全量修复（真实按 seq、pending 排末尾）。
 * 仅 BuildConfig.DEBUG（debug 构建）执行；release 构建常量折叠为 if(false)，零开销。
 * 用 System.err 而非 android.util.Log：保持纯 JVM（单测直跑不依赖 mock 的 android.jar）。
 */
private fun assertSortedOrRepair(arr: MutableList<Message>) {
    var prev = Long.MIN_VALUE
    var bad = false
    for (m in arr) {
        val s = seqOf(m) ?: continue
        if (s < prev) { bad = true; break }
        prev = s
    }
    if (bad) {
        System.err.println(
            "[ChatMessageMerge] 消息数组未按 server_sequence 有序(忽略 pending), 降级全量修复: " +
                arr.map { "${it.id}(${seqOf(it)})" }
        )
        val sorted = arr.sortedWith(compareBy({ seqOf(it) ?: Long.MAX_VALUE }, { it.created_at }))
        arr.clear()
        arr.addAll(sorted)
    }
}
