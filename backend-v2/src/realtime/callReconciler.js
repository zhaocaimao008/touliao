'use strict';
/**
 * 服务进程重启收尾（Task 4，2026-08-31）。
 *
 * callSessionRegistry 是纯内存状态（单进程 fork，见 callSessionRegistry.js），进程
 * 重启必然丢失全部进行中通话的媒体会话——SDP/ICE、设备 socket 所有权、对端状态在
 * 单进程重启后无法可靠恢复，这里不尝试重建 PeerConnection。
 *
 * 但重启前数据库里残留的 status='ongoing' 记录不会自己消失：不收尾的话，通话历史
 * UI 会永久显示"通话中"，具有误导性（用户会以为这通电话真的还没结束）。启动时
 * 统一把这些悬挂记录标成明确的终态：
 *   - 1对1 (call_logs)：'interrupted'，四端历史列表都要能展示这个新状态
 *     （见 web/src/components/CallHistory.jsx、android CallHistoryScreen.kt、
 *     ios CallHistoryView.swift 的 statusLabel/STATUS 映射）。
 *   - 群通话 (group_call_logs)：直接标 'ended'，这张表的 status 本来就只有
 *     ongoing|ended 两种取值（见 db/schema.js 的表注释），不单独区分"因重启中断"。
 */
const { writeAsync } = require('../db/writer');

async function reconcileInterruptedCalls(nowSec) {
  await writeAsync(
    "UPDATE call_logs SET status='interrupted', ended_at=? WHERE status='ongoing' AND ended_at IS NULL",
    [nowSec]
  );
  await writeAsync(
    "UPDATE group_call_logs SET status='ended', ended_at=? WHERE status='ongoing' AND ended_at IS NULL",
    [nowSec]
  );
}

module.exports = { reconcileInterruptedCalls };
