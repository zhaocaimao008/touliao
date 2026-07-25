// 新消息提示音：WebAudio 生成短促「叮-咚」，零音频文件依赖。
// 独立于桌面通知权限——即使用户未授权 Notification，也能听到提示音。
let _ctx = null;
let _lastPlay = 0;
let _enabled = true; // 由设置开关控制（尊重「声音」设置）

export function setMessageSoundEnabled(on) { _enabled = !!on; }

function getCtx() {
  if (!_ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) _ctx = new AC();
  }
  if (_ctx && _ctx.state === 'suspended') _ctx.resume().catch(() => {});
  return _ctx;
}

export function playMessageTone() {
  if (!_enabled) return;
  // 节流：300ms 内多条消息只响一次，避免连发刷屏噪音
  const now = Date.now();
  if (now - _lastPlay < 300) return;
  _lastPlay = now;
  const ctx = getCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const tone = (freq, start, dur) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t + start);
    gain.gain.exponentialRampToValueAtTime(0.2, t + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t + start); osc.stop(t + start + dur);
  };
  tone(880, 0, 0.15);      // 叮
  tone(1174.7, 0.13, 0.18); // 咚（上扬）
}
