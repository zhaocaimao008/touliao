package com.touliao.app.core.call

/**
 * "通话中"常驻通知的展示模型（CALL-6）。纯 Kotlin，不引用 android.*，便于 JVM 单测。
 *
 * 只保留通知真正展示的字段：通话质量、扬声器、麦克风等状态的变化不会产生新的模型，
 * 配合 distinctUntilChanged，前台服务不会因为这些变化频繁刷新通知。
 *
 * @param kind 通话类型：[CallIntents.KIND_P2P] 或 [CallIntents.KIND_GROUP]，随"挂断"广播带给 CallActionReceiver
 * @param callId 服务端通话 id（可能为空），挂断时用来防止旧通知挂掉新的一通
 * @param connectedAtElapsed 接通时刻（elapsedRealtime 口径）；未接通为 0，此时通知不显示计时
 */
data class OngoingCallModel(
    val kind: String,
    val callId: String,
    val title: String,
    val text: String,
    val isVideo: Boolean,
    val connectedAtElapsed: Long,
) {
    companion object {
        /** 服务刚启动、两路状态都还不是进行中时的占位内容 */
        fun placeholder(video: Boolean) = OngoingCallModel(CallIntents.KIND_P2P, "", "投聊通话", "通话中", video, 0L)
    }
}

/**
 * 由 1v1 状态、群通话状态和群名单生成"通话中"通知的内容。
 * - 1v1 进行中（拨出 / 连接中 / 已接通）优先；
 * - 否则群通话进行中（连接中 / 已接通）；
 * - 其余情况（空闲、响铃、结束）返回 null，前台服务据此停止自己。
 * 群名只在名单属于同一会话时使用，避免显示上一通群通话的群名。
 */
fun ongoingModelOf(call: CallState, group: GroupCallState, roster: GroupRoster): OngoingCallModel? {
    if (CallUiRules.isP2pActive(call.stage)) {
        val connected = call.stage == CallStage.CONNECTED
        val text = when (call.stage) {
            CallStage.OUTGOING -> "正在呼叫…"
            CallStage.CONNECTING -> "连接中…"
            else -> if (call.isVideo) "视频通话中" else "语音通话中"
        }
        return OngoingCallModel(
            kind = CallIntents.KIND_P2P,
            callId = call.callId,
            title = call.peerName.ifBlank { "投聊通话" },
            text = text,
            isVideo = call.isVideo,
            connectedAtElapsed = if (connected) call.connectedAt else 0L,
        )
    }
    if (CallUiRules.isGroupActive(group.stage)) {
        val connected = group.stage == GroupCallStage.CONNECTED
        val groupName = if (roster.conversationId == group.conversationId) roster.groupName else ""
        val text = if (connected) {
            "群${if (group.isVideo) "视频" else "语音"}通话 · ${group.participants.size + 1}人"
        } else {
            "正在加入群通话…"
        }
        return OngoingCallModel(
            kind = CallIntents.KIND_GROUP,
            callId = group.callId,
            title = groupName.ifBlank { "群通话" },
            text = text,
            isVideo = group.isVideo,
            connectedAtElapsed = if (connected) group.connectedAt else 0L,
        )
    }
    return null
}
