// 启动期提前发起的身份核验（GET /api/auth/me）。
// main.jsx 在 baseURL/拦截器/Bearer 就绪后立即发出，与语言包预载、React 首次渲染并行；
// AuthProvider 挂载时若会话代次未变则直接复用这次请求，不再串行等待自己的 effect。
import { captureSession, isOperationCurrent } from './sessionContext';

let pending = null;

export function startAuthCheck(axios) {
  if (pending) return pending;
  const operation = captureSession();
  const promise = axios.get('/api/auth/me', { _sessionContext: operation });
  promise.catch(() => {}); // 结果由 AuthProvider 消费；未被消费时避免 unhandled rejection
  pending = { operation, promise };
  return pending;
}

/** 取走预发的核验（只能取一次）；会话已变化时返回 null，调用方自行重发。 */
export function takeAuthCheck() {
  const p = pending;
  pending = null;
  if (!p || !isOperationCurrent(p.operation)) return null;
  return p;
}
