/**
 * 通话提示音公共模块(WebAudio 合成,零音频文件依赖)。
 *
 * 三音:回铃音(主叫等待)/ 来电铃声(被叫 incoming)/ 接通提示音。
 * 与 Android ToneGenerator / iOS CallTonePlayer 对齐,频率风格一致。
 *
 * ── autoplay 策略处理(关键)──────────────────────────────────────
 * Chrome 要求 AudioContext 的创建/resume 发生在用户手势栈内,React 的
 * useEffect 是异步调度的,不在手势栈 → 此前主叫回铃音被浏览器静默拦掉
 * (根因,见 AUDIT)。解法:
 *   1. prewarm():在任何用户交互(pointerdown/keydown/touchstart)的
 *      事件处理栈内同步创建 AudioContext,页面首次交互即完成预热;
 *   2. 呼叫按钮 onClick 也显式调用一次(双保险);
 *   3. sticky activation 后创建的 AudioContext 直接以 running 状态启动,
 *      后续所有提示音无需再请求手势。
 * 被叫来电铃声依赖页面已被预热(sticky activation)——用户在页面上基本
 * 必然有过交互;完全零交互场景受浏览器政策硬限制,无法绕过。
 */
let _ctx = null;

/** 预热:在用户手势栈内同步创建/恢复 AudioContext(幂等)。 */
export function prewarmAudio() {
  try {
    if (!_ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      _ctx = new AC();
    }
    if (_ctx.state === 'suspended') {
      // 在事件处理栈内调用 → 拒绝概率极低;失败只告警,不阻塞通话
      _ctx.resume().catch((e) => console.warn('[tones] AudioContext resume 失败:', e?.message || e));
    }
  } catch (e) {
    console.warn('[tones] AudioContext 预热失败:', e?.message || e);
  }
  return _ctx;
}

/** 页面级首次交互即预热(一次):pointerdown 覆盖触屏,keydown 覆盖键盘。 */
let _prewarmInstalled = false;
export function installPrewarm() {
  if (_prewarmInstalled || typeof document === 'undefined') return;
  _prewarmInstalled = true;
  const warm = () => { prewarmAudio(); };
  document.addEventListener('pointerdown', warm, { once: true, passive: true });
  document.addEventListener('keydown', warm, { once: true, passive: true });
  document.addEventListener('touchstart', warm, { once: true, passive: true });
}

function getCtx() {
  return _ctx || prewarmAudio();
}

/** 单次蜂鸣：durationMs 时长,freqs 多频叠加,尾端淡出防爆音。delayMs 延迟(ms)用于多段音序。 */
function beep(freqs, durationMs, volume = 0.13, delayMs = 0) {
  const ctx = getCtx();
  if (!ctx) return null;
  const t = ctx.currentTime + delayMs / 1000;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.05);
  gain.gain.setValueAtTime(volume, t + durationMs / 1000 - 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + durationMs / 1000);
  for (const f of freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + durationMs / 1000 + 0.01);
  }
  gain.connect(ctx.destination);
  return { stop: () => { try { gain.disconnect(); } catch { /* 已断开 */ } } };
}

/**
 * 循环提示音:onBeep 每次响,intervalMs 周期。
 * 返回 { stop }。
 */
function loop(intervalMs, onBeep) {
  let stopped = false;
  onBeep();
  const iv = setInterval(() => { if (!stopped) onBeep(); }, intervalMs);
  return { stop: () => { stopped = true; clearInterval(iv); } };
}

// 模块级当前循环音句柄:startXxx 会停掉上一个,stopTone 全局停
let _current = null;
function startLoop(factory) {
  stopTone();
  _current = factory();
  return _current;
}

/** 停止当前循环提示音(幂等)。 */
export function stopTone() {
  _current?.stop();
  _current = null;
}

/** 回铃音:中国制式「响1秒·停4秒」450Hz(主叫拨出→接通前)。 */
export function startRingback() {
  return startLoop(() => loop(5000, () => beep([450], 1000)));
}

/** 来电铃声:预设按 ringtone key 映射(设置页可选,服务端 user_settings.ringtone)。 */
const RINGTONE_PRESETS = {
  // 经典:450+500Hz 双音「响1.2秒·停3秒」
  classic: { loopMs: 4200, beeps: [[[450, 500], 1200, 0.15, 0]] },
  // 交替双音:450Hz→500Hz 轮换,节奏更快
  dual:    { loopMs: 2000, beeps: [[[450], 800, 0.14, 0], [[500], 800, 0.14, 1000]] },
  // 三连音:450Hz 短促三响
  triple:  { loopMs: 3000, beeps: [[[450], 250, 0.15, 0], [[450], 250, 0.15, 320], [[450], 250, 0.15, 640]] },
  // 轻柔:400Hz 单音低音量
  soft:    { loopMs: 5000, beeps: [[[400], 1500, 0.08, 0]] },
};
let _ringtone = 'classic';

/** 设置当前来电铃声 key（设置页/启动时从服务端 user_settings 读取后调用）。 */
export function setIncomingRingtone(key) {
  if (RINGTONE_PRESETS[key]) _ringtone = key;
}

/** 来电铃声:按当前 ringtone key 播放循环音。 */
export function startIncomingTone() {
  const preset = RINGTONE_PRESETS[_ringtone] || RINGTONE_PRESETS.classic;
  return startLoop(() => loop(preset.loopMs, () => {
    for (const [freqs, dur, vol, delay] of preset.beeps) beep(freqs, dur, vol, delay);
  }));
}

/** 接通提示音:一声短促上扬「叮」1000Hz。 */
export function playConnectedTone() {
  return beep([1000], 180, 0.15);
}
