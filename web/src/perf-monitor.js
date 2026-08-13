/**
 * 投聊 端到端性能打点模块
 *
 * 用法: import './perf-monitor.js' 或其他方式注入
 *
 * 记录:
 *   perf.send(clientMsgId, userId)        — 发送端记录发送时间
 *   perf.recv(convId, msg, userId)        — 接收端记录收到时间
 *   perf.render(msgId, elapsedMs)         — React setMessages 完成时间
 *   perf.getReport()                      — 输出报告
 */

(function () {
  if (window.__touliaoPerf) return;
  const P = {
    sends: new Map(),      // clientMsgId → { t0, userId, conversationId }
    recvs: [],             // { clientMsgId, tReceive, userId, conversationId, tRender, source }
    renders: new Map(),    // msgId → { tRender }
    domPaint: new Map(),   // msgId → { tPaint }
    totalLatency: [],      // tReceive - t0 (send→receive)
    ackLatency: [],        // ack - t0 (send→ack)
    renderLatency: [],     // tRender - tReceive (socket→state)
    paintLatency: [],      // tPaint - tRender (state→DOM)
    fileLatency: [],       // file send→receive
    observer: null,
  };

  // DOM paint 观察者 (MutationObserver 检测消息气泡出现)
  function initObserver() {
    if (P.observer) return;
    P.observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1 && node.matches && node.matches('[data-msg-id]')) {
            const msgId = node.getAttribute('data-msg-id');
            P.domPaint.set(msgId, { tPaint: performance.now() });
            if (P.renders.has(msgId)) {
              const render = P.renders.get(msgId);
              P.paintLatency.push(performance.now() - render.tRender);
            }
          }
        }
      }
    });
    P.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  window.__touliaoPerf = {
    send(clientMsgId, userId, conversationId) {
      P.sends.set(clientMsgId, { t0: performance.now(), userId, conversationId });
      P.totalLatency.length = 0; // reset accumulator
    },

    ack(clientMsgId, _userId) {
      const s = P.sends.get(clientMsgId);
      if (s) {
        P.ackLatency.push(performance.now() - s.t0);
        if (P.ackLatency.length > 10000) P.ackLatency.shift();
      }
    },

    recv(msg, userId, source) {
      const clientMsgId = msg.clientMsgId || msg.id;
      const s = P.sends.get(clientMsgId);
      const tReceive = performance.now();
      if (s) {
        // 收到自己发的消息（广播回来）= 完整端到端延迟
        const lat = tReceive - s.t0;
        P.totalLatency.push(lat);
        if (P.totalLatency.length > 10000) P.totalLatency.shift();
      }
      P.recvs.push({ clientMsgId, tReceive, userId, conversationId: msg.conversation_id, source });
      if (msg.file_url && msg.file_url.length > 50) {
        // 文件消息特殊标记
        const s2 = P.sends.get(clientMsgId);
        if (s2) {
          P.fileLatency.push(tReceive - s2.t0);
          if (P.fileLatency.length > 10000) P.fileLatency.shift();
        }
      }
    },

    render(msgId) {
      P.renders.set(msgId, { tRender: performance.now() });
      const recv = P.recvs.find(r => r.clientMsgId === msgId || r.clientMsgId === msgId);
      if (recv) {
        P.renderLatency.push(performance.now() - recv.tReceive);
        if (P.renderLatency.length > 10000) P.renderLatency.shift();
      }
    },

    paint(msgId) {
      // Called from react ref callback or componentDidMount
      P.domPaint.set(msgId, { tPaint: performance.now() });
      if (P.renders.has(msgId)) {
        P.paintLatency.push(performance.now() - P.renders.get(msgId).tRender);
        if (P.paintLatency.length > 10000) P.paintLatency.shift();
      }
    },

    pct(arr, p) {
      if (!arr || arr.length === 0) return 0;
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.ceil(p / 100 * s.length) - 1] || 0;
    },

    getReport() {
      const r = P;
      return {
        totalCount: r.totalLatency.length,
        ackCount: r.ackLatency.length,
        renderCount: r.renderLatency.length,
        paintCount: r.paintLatency.length,
        fileCount: r.fileLatency.length,
        total: {
          p50: this.pct(r.totalLatency, 50).toFixed(1) + 'ms',
          p95: this.pct(r.totalLatency, 95).toFixed(1) + 'ms',
          p99: this.pct(r.totalLatency, 99).toFixed(1) + 'ms',
        },
        send_to_ack: {
          p50: this.pct(r.ackLatency, 50).toFixed(1) + 'ms',
          p95: this.pct(r.ackLatency, 95).toFixed(1) + 'ms',
          p99: this.pct(r.ackLatency, 99).toFixed(1) + 'ms',
        },
        socket_to_render: {
          p50: this.pct(r.renderLatency, 50).toFixed(1) + 'ms',
          p95: this.pct(r.renderLatency, 95).toFixed(1) + 'ms',
          p99: this.pct(r.renderLatency, 99).toFixed(1) + 'ms',
        },
        render_to_paint: {
          p50: this.pct(r.paintLatency, 50).toFixed(1) + 'ms',
          p95: this.pct(r.paintLatency, 95).toFixed(1) + 'ms',
          p99: this.pct(r.paintLatency, 99).toFixed(1) + 'ms',
        },
        file_latency: {
          p50: this.pct(r.fileLatency, 50).toFixed(1) + 'ms',
          p95: this.pct(r.fileLatency, 95).toFixed(1) + 'ms',
          p99: this.pct(r.fileLatency, 99).toFixed(1) + 'ms',
        },
      };
    },

    showOverlay() {
      const div = document.createElement('div');
      div.id = '__touliaoPerfPanel';
      div.style.cssText = 'position:fixed;bottom:10px;left:10px;z-index:99999;background:rgba(0,0,0,0.85);color:#0f0;padding:12px;border-radius:8px;font:12px/1.5 monospace;max-height:300px;overflow-y:auto;min-width:280px;';
      const update = () => {
        const r = this.getReport();
        // textContent 替代 innerHTML，消除 XSS 风险（最佳实践）
        div.textContent = [
          '┌─── 投聊性能实时 ───┐',
          `总端对端(${r.totalCount}) p50=${r.total.p50} p95=${r.total.p95} p99=${r.total.p99}`,
          `发→Ack(${r.ackCount})   p50=${r.send_to_ack.p50} p95=${r.send_to_ack.p95}`,
          `Sock→渲(${r.renderCount}) p50=${r.socket_to_render.p50} p95=${r.socket_to_render.p95}`,
          `渲→绘(${r.paintCount})  p50=${r.render_to_paint.p50} p95=${r.render_to_paint.p95}`,
          `文件(${r.fileCount})    p50=${r.file_latency.p50} p95=${r.file_latency.p95}`,
        ].join('\n');
        // 关闭按钮（安全方式）
        if (!div.querySelector('button')) {
          const btn = document.createElement('button');
          btn.textContent = '关闭';
          btn.style.cssText = 'display:block;margin-top:6px;cursor:pointer';
          btn.onclick = () => div.remove();
          div.appendChild(btn);
        }
        requestAnimationFrame(update);
      };
      document.body.appendChild(div);
      initObserver();
      update();
    },
  };
})();

// Auto-show on ?perf=1
if (location.search.includes('perf=1')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.__touliaoPerf.showOverlay());
  } else {
    window.__touliaoPerf.showOverlay();
  }
}

console.debug('[touliaoPerf] 性能打点已加载');
