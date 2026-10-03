// Socket 重连后等服务端确认原参与设备的绑定；旧服务端没有 ack 时短暂等待后兼容放行。
// 每次重连都有独立代次，断线或卸载后迟到的回执不能恢复当前信令。
export function createCallResumeGate({ onReady, onRejected, setTimer = setTimeout, clearTimer = clearTimeout, delay = 1500 }) {
  let epoch = 0;
  let timer = null;
  let ready = false;

  const stop = () => {
    epoch += 1;
    clearTimer(timer);
    timer = null;
  };

  const begin = () => {
    stop();
    const current = epoch;
    ready = false;
    const release = () => {
      if (current !== epoch || ready) return;
      ready = true;
      clearTimer(timer);
      timer = null;
      onReady();
    };
    timer = setTimer(release, delay);
    return (ack) => {
      if (current !== epoch) return;
      if (ack?.ok === false) {
        stop();
        onRejected();
      } else {
        release();
      }
    };
  };

  return { begin, stop };
}
