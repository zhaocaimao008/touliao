// 附件格式判定：全部基于真实 mime（服务端魔数校验后落库的 file_mime）+ 扩展名兜底。
// 独立成纯逻辑模块（不依赖任何浏览器/Electron 全局对象），方便单测，也供 FilePreview.jsx
// 等 UI 组件复用。
const PDF_TYPES = new Set(['application/pdf']);
const DOCX_TYPES = new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const XLSX_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);
const PPTX_TYPES = new Set(['application/vnd.openxmlformats-officedocument.presentationml.presentation']);
const TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'csv', 'log', 'json']);

export function extOf(name) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

/** 返回 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'text' | 'generic'（不支持App内预览的格式）。 */
export function classify(mime, filename) {
  const ext = extOf(filename);
  if (PDF_TYPES.has(mime) || ext === 'pdf') return 'pdf';
  if (DOCX_TYPES.has(mime) || ext === 'docx') return 'docx';
  if (XLSX_TYPES.has(mime) || ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (PPTX_TYPES.has(mime) || ext === 'pptx') return 'pptx';
  if (TEXT_EXTS.has(ext) || (mime || '').startsWith('text/')) return 'text';
  // 明确不支持内部预览的：doc(旧二进制)、ppt(旧二进制)、zip/rar 等压缩包、其他二进制格式
  return 'generic';
}
