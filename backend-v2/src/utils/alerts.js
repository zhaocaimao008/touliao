'use strict';
/**
 * 主动告警：Telegram 推送。
 *
 * 复用 deploy/touliao-backup.sh 里已经在用的同一套 ALERT_BOT_TOKEN/ALERT_CHAT_ID 约定——
 * 未配置时静默跳过，不是新引入的告警渠道/供应商决策。
 *
 * 见 AUDIT.md 十七节"基础监控"🟡：此前 GET /api/admin/metrics 只是拉取式仪表盘，越限记录
 * （prodMetrics.js 的 pushAlert）只进内存环形缓冲，运维必须主动打开后台面板才能看到，
 * 没有任何主动推送能力。
 */

async function sendTelegramAlert(text) {
  const token = process.env.ALERT_BOT_TOKEN;
  const chatId = process.env.ALERT_CHAT_ID;
  if (!token || !chatId) return; // 未配置：静默跳过，与 touliao-backup.sh 的 tg() 行为一致

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.warn('[alerts] Telegram 返回非 2xx:', res.status);
  } catch (err) {
    // 告警本身发送失败不应该影响主流程，也不重试——重试逻辑本身可能变成新的故障源，
    // 静默记录一条 warn 即可，人还有 /api/admin/metrics 仪表盘作为兜底查看渠道。
    console.warn('[alerts] Telegram 发送失败:', err.message);
  }
}

module.exports = { sendTelegramAlert };
