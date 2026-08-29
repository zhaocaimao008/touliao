// 兼容旧调用点：真正的下载逻辑已经统一进 downloadManager.js（含进度/取消/重试/并发限制）。
// 本文件只做向后兼容转发，避免所有旧的 `import { downloadFile } from './download'` 调用点
// 都要跟着改成 downloadManager——新代码（文件卡片等需要展示下载进度的地方）请直接使用
// downloadManager 的 startDownload/subscribe/cancelDownload/retryDownload。
export { downloadFile } from './downloadManager';
