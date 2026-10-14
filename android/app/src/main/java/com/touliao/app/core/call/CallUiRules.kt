package com.touliao.app.core.call

/**
 * 通话界面规则（跨包契约 C2）。纯函数、纯 Kotlin，不引用 android.*，便于 JVM 单测覆盖。
 *
 * - 自动拉起（[mainShouldOpenCallUi]）：MainActivity 自己处于 STARTED 时，若通话页不在前台，
 *   且 1v1 正在响铃 / 刚结束（显示结束页）/ 进行中未被用户收起，或群通话进行中未被收起，
 *   就拉起 CallActivity。用户主动收起（isMinimized=true）的通话只显示应用内小窗，不自动拉起。
 * - 宿主渲染（[displayKind]）：CallActivity 决定渲染哪一路。1v1 只要不是 IDLE（包括 ENDED 结束页）
 *   就优先于群通话，两路都 IDLE 时 CallActivity 结束自己。
 * - 小窗（[bubbleKind]）：MainActivity 的 CallOverlay 只为"进行中且被用户收起"的那一路画小窗，1v1 优先。
 * - 亮屏（[turnScreenOn]）：只有 1v1 响铃时 CallActivity 才动态点亮屏幕；其余阶段撤掉亮屏。
 * - 群通话中来 1v1（[rejectP2pForGroup]）：1v1 空闲且群通话进行中时，新的 1v1 来电回忙线，不进 INCOMING 盖住群通话。
 */
enum class CallUiKind { NONE, P2P, GROUP }

object CallUiRules {

    /** 1v1 进行中（拨出、连接中、已接通）。响铃（INCOMING）和结束（ENDED）不算。 */
    fun isP2pActive(stage: CallStage): Boolean =
        stage == CallStage.OUTGOING || stage == CallStage.CONNECTING || stage == CallStage.CONNECTED

    /** 群通话进行中（连接中、已接通）。 */
    fun isGroupActive(stage: GroupCallStage): Boolean =
        stage == GroupCallStage.CONNECTING || stage == GroupCallStage.CONNECTED

    /** CallActivity 渲染哪一路：1v1 非 IDLE 优先（含 ENDED 结束页），其次群通话非 IDLE，否则 NONE。 */
    fun displayKind(call: CallState, group: GroupCallState): CallUiKind = when {
        call.stage != CallStage.IDLE -> CallUiKind.P2P
        group.stage != GroupCallStage.IDLE -> CallUiKind.GROUP
        else -> CallUiKind.NONE
    }

    /** MainActivity 可见时是否应拉起 CallActivity（通话页已在前台时一律不拉）。 */
    fun mainShouldOpenCallUi(call: CallState, group: GroupCallState, callUiStarted: Boolean): Boolean =
        !callUiStarted && (
            call.stage == CallStage.INCOMING ||
                call.stage == CallStage.ENDED ||
                (isP2pActive(call.stage) && !call.isMinimized) ||
                (isGroupActive(group.stage) && !group.isMinimized)
            )

    /** 应用内小窗显示哪一路：进行中且被用户收起的那一路，1v1 优先。 */
    fun bubbleKind(call: CallState, group: GroupCallState): CallUiKind = when {
        isP2pActive(call.stage) && call.isMinimized -> CallUiKind.P2P
        isGroupActive(group.stage) && group.isMinimized -> CallUiKind.GROUP
        else -> CallUiKind.NONE
    }

    /** CallActivity 是否需要点亮屏幕：仅 1v1 响铃时。 */
    fun turnScreenOn(call: CallState): Boolean = call.stage == CallStage.INCOMING

    /** 1v1 空闲（IDLE/ENDED）且群通话进行中（连接中/已接通）：新的 1v1 来电应回忙线，不进 INCOMING 盖住群通话。 */
    fun rejectP2pForGroup(call: CallStage, group: GroupCallStage): Boolean =
        (call == CallStage.IDLE || call == CallStage.ENDED) && isGroupActive(group)
}
