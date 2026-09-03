import React, { useEffect, useRef, useState, useCallback } from 'react';
import { mediaUrl } from '../utils/url';
import { startDownload, subscribe, cancelDownload, retryDownload } from '../utils/downloadManager';
import { shareMessage, canShare } from '../utils/share';
import { humanFileSize as humanSize } from '../utils/fileSize';
import { classify, extOf } from '../utils/attachmentType';
import { useI18n } from '../contexts/I18nContext';

// ── 各格式子渲染器 ──────────────────────────────────────────────

function PdfRenderer({ url, onLoaded, onError }) {
  const { t } = useI18n();
  const containerRef = useRef(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const docRef = useRef(null);
  const renderTokenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
        const doc = await pdfjsLib.getDocument({ url, withCredentials: true }).promise;
        if (cancelled) return;
        docRef.current = doc;
        setNumPages(doc.numPages);
        onLoaded?.();
      } catch (e) {
        if (!cancelled) onError?.(e?.message || t('filePreview.pdfParseFailed'));
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onLoaded/onError 是父组件每次渲染新建的内联回调，只应在 url 变化时重新执行
  }, [url]);

  useEffect(() => {
    if (!docRef.current || !numPages) return;
    const myToken = ++renderTokenRef.current;
    (async () => {
      const container = containerRef.current;
      if (!container) return;
      container.innerHTML = '';
      // 逐页渲染到独立 canvas，支持滚动查看全部页；页数很多时可后续加虚拟化，
      // 当前先保证正确性——聊天场景 PDF 页数通常有限，全渲染不是性能瓶颈。
      for (let i = 1; i <= numPages; i++) {
        if (renderTokenRef.current !== myToken) return; // 缩放触发了重渲染，放弃过期任务
        const page = await docRef.current.getPage(i);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.cssText = 'display:block;margin:0 auto 12px;box-shadow:0 2px 12px rgba(0,0,0,.15);background:#fff;';
        container.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
      }
    })();
  }, [numPages, scale]);

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'auto', padding: '16px 0' }}>
      <div ref={containerRef} />
      {/* 缩放控制 */}
      <div style={{
        position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: 8, background: 'rgba(0,0,0,.6)', borderRadius: 20, padding: '6px 14px',
      }}>
        <button onClick={() => setScale(s => Math.max(0.5, s - 0.25))} style={zoomBtnStyle}>－</button>
        <span style={{ color: '#fff', fontSize: 13, alignSelf: 'center' }}>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale(s => Math.min(3, s + 0.25))} style={zoomBtnStyle}>＋</button>
      </div>
    </div>
  );
}
const zoomBtnStyle = { border: 'none', background: 'transparent', color: '#fff', fontSize: 18, cursor: 'pointer', width: 24 };

function DocxRenderer({ url, onLoaded, onError }) {
  const { t } = useI18n();
  const containerRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const buf = await resp.arrayBuffer();
        if (cancelled) return;
        const { renderAsync } = await import('docx-preview');
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
          await renderAsync(buf, containerRef.current, undefined, {
            className: 'wc-docx', inWrapper: true, ignoreWidth: false, ignoreHeight: false,
          });
        }
        onLoaded?.();
      } catch (e) {
        if (!cancelled) onError?.(e?.message || t('filePreview.wordParseFailed'));
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onLoaded/onError 是父组件每次渲染新建的内联回调，只应在 url 变化时重新执行
  }, [url]);
  return <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'auto', background: '#fff', padding: '20px 0' }} />;
}

function XlsxRenderer({ url, onLoaded, onError }) {
  const { t } = useI18n();
  const [sheets, setSheets] = useState(null);
  const [activeSheet, setActiveSheet] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const buf = await resp.arrayBuffer();
        if (cancelled) return;
        const [XLSX, { default: DOMPurify }] = await Promise.all([import('xlsx'), import('dompurify')]);
        const wb = XLSX.read(buf, { type: 'array' });
        // sheet_to_html 把单元格内容原样拼进 HTML：恶意 .xlsx（任意联系人发的文件都会走这条预览）
        // 能在单元格里塞 <script>/onerror 之类的标签，不清洗就直接喂进 dangerouslySetInnerHTML
        // 等于在预览者的已登录会话里执行任意脚本（存储型 XSS）。
        const parsed = wb.SheetNames.map(name => ({
          name,
          html: DOMPurify.sanitize(XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false })),
        }));
        setSheets(parsed);
        onLoaded?.();
      } catch (e) {
        if (!cancelled) onError?.(e?.message || t('filePreview.excelParseFailed'));
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onLoaded/onError 是父组件每次渲染新建的内联回调，只应在 url 变化时重新执行
  }, [url]);

  if (!sheets) return null;
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      {sheets.length > 1 && (
        <div style={{ display: 'flex', gap: 4, padding: '8px 12px', overflowX: 'auto', borderBottom: '1px solid #eee', flexShrink: 0 }}>
          {sheets.map((s, i) => (
            <button key={s.name} onClick={() => setActiveSheet(i)}
              style={{
                border: 'none', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
                background: i === activeSheet ? 'var(--brand-primary, #07C160)' : '#f0f0f0',
                color: i === activeSheet ? '#fff' : '#333', fontSize: 13,
              }}>{s.name}</button>
          ))}
        </div>
      )}
      <div
        className="wc-xlsx-table-wrap"
        style={{ flex: 1, overflow: 'auto', padding: 12 }}
        dangerouslySetInnerHTML={{ __html: sheets[activeSheet]?.html || '' }}
      />
    </div>
  );
}

function TextRenderer({ url, filename, onLoaded, onError }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const isMd = extOf(filename) === 'md' || extOf(filename) === 'markdown';
  const isCsv = extOf(filename) === 'csv';
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const t = await resp.text();
        if (!cancelled) { setText(t); onLoaded?.(); }
      } catch (e) {
        if (!cancelled) onError?.(e?.message || t('filePreview.fileReadFailed'));
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onLoaded/onError 是父组件每次渲染新建的内联回调，只应在 url 变化时重新执行
  }, [url]);

  if (isCsv) {
    const rows = text.split(/\r?\n/).filter(r => r.length).map(r => r.split(','));
    return (
      <div style={{ width: '100%', height: '100%', overflow: 'auto', background: '#fff', padding: 16 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => (
                <td key={j} style={{ border: '1px solid #e5e5e5', padding: '4px 8px', fontSize: 13 }}>{c}</td>
              ))}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <pre style={{
      width: '100%', height: '100%', overflow: 'auto', background: '#fff', margin: 0,
      padding: 20, boxSizing: 'border-box', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
      wordBreak: 'break-word', fontFamily: isMd ? 'inherit' : 'ui-monospace, monospace', color: '#222',
    }}>{text}</pre>
  );
}

// PPTX：没有成熟稳定的纯前端高保真渲染方案（不使用会把私有文件传到第三方网站的在线转换服务）。
// 退化为"逐张幻灯片文字内容提取预览"——用 jszip 直接读 pptx(本质是zip)里每张幻灯片 XML 的
// 文本节点，不还原版式/图片，但至少能在 App 内看到每页写了什么，比完全不能预览、
// 只能下载好。明确告知用户这是简化预览。
function PptxRenderer({ url, onLoaded, onError }) {
  const { t } = useI18n();
  const [slides, setSlides] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const buf = await resp.arrayBuffer();
        if (cancelled) return;
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(buf);
        const slideFiles = Object.keys(zip.files)
          .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
          .sort((a, b) => {
            const na = parseInt(a.match(/slide(\d+)\.xml/)[1], 10);
            const nb = parseInt(b.match(/slide(\d+)\.xml/)[1], 10);
            return na - nb;
          });
        const parser = new DOMParser();
        const out = [];
        for (const name of slideFiles) {
          const xml = await zip.files[name].async('text');
          const doc = parser.parseFromString(xml, 'application/xml');
          const texts = Array.from(doc.getElementsByTagName('a:t')).map(n => n.textContent).filter(Boolean);
          out.push(texts);
        }
        if (!cancelled) { setSlides(out); onLoaded?.(); }
      } catch (e) {
        if (!cancelled) onError?.(e?.message || t('filePreview.pptParseFailed'));
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onLoaded/onError 是父组件每次渲染新建的内联回调，只应在 url 变化时重新执行
  }, [url]);

  if (!slides) return null;
  return (
    <div style={{ width: '100%', height: '100%', overflow: 'auto', background: '#fff', padding: 16 }}>
      <div style={{
        background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 8,
        padding: '8px 12px', fontSize: 12, color: '#8a6d00', marginBottom: 16,
      }}>
        {t('filePreview.pptxSimplifiedNotice')}
      </div>
      {slides.map((texts, i) => (
        <div key={i} style={{
          border: '1px solid #e5e5e5', borderRadius: 8, padding: 16, marginBottom: 12,
          aspectRatio: '16/9', display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>{t('filePreview.pageTemplate').replace('{n}', i + 1)}</div>
          {texts.length ? texts.map((t, j) => <div key={j} style={{ fontSize: 15, marginBottom: 4 }}>{t}</div>)
            : <div style={{ color: '#bbb', fontSize: 13 }}>{t('filePreview.pptxNoTextContent')}</div>}
        </div>
      ))}
    </div>
  );
}

function iconFor(kind) {
  // 统一走 SVG，不用 emoji（正式 UI 规范要求）
  const paths = {
    pdf: 'M6 2h9l5 5v13a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zm8 1.5V8h4.5L14 3.5zM8 13h1.5a1.5 1.5 0 000-3H8v3zm0 1.5V17h1v-2.5H8zm4-3.5h1.2c1 0 1.8.7 1.8 1.75S14.2 14.5 13.2 14.5H13V17h-1v-6zm1 3.5h.2c.4 0 .7-.3.7-.75s-.3-.75-.7-.75H13v1.5zM17 11h1v6h-1v-2.5h1.5V13H18v-1h1.5v-1H17z',
    generic: 'M6 2h9l5 5v13a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zm8 1.5V8h4.5L14 3.5z',
  };
  return paths[kind] || paths.generic;
}

/**
 * 文档/文件全屏预览：PDF/Word/Excel/PPT/TXT/MD/CSV 走对应渲染器 App 内预览；
 * 其他不支持内部预览的格式（zip/rar/doc(旧)/ppt(旧)等二进制）进入"文件详情页"
 * ——只显示信息+下载/保存/分享/用其他应用打开，绝不自动跳浏览器。
 * 与 ImagePreview/VideoPreview 对齐的全屏遮罩交互：Esc 关闭、底部操作条。
 */
export default function FilePreview({ fileUrl, filename, mimeType, fileSize, onClose }) {
  const { t } = useI18n();
  const url = mediaUrl(fileUrl);
  const kind = classify(mimeType, filename);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [errorMsg, setErrorMsg] = useState('');
  const [dl, setDl] = useState(null);
  const dlIdRef = useRef(null);

  const handleKeyDown = useCallback((e) => { if (e.key === 'Escape') onClose(); }, [onClose]);
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', handleKeyDown); document.body.style.overflow = ''; };
  }, [handleKeyDown]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- generic 类型无需异步加载，直接同步置为 ready
    if (kind === 'generic') setLoadState('ready'); // 详情页不需要异步加载
  }, [kind]);

  const startSave = () => {
    // generic(投聊内不支持预览的格式)：这就是规范要求的"用户主动选择用其他应用打开"
    // 那个动作本身，此时才允许下载完成后自动调用系统默认程序；其余格式投聊自己能
    // 预览，保存到本地只是要一份文件，不应该也跳去打开系统默认程序。
    const id = startDownload({ fileUrl, filename, mimeType, autoOpen: kind === 'generic' });
    dlIdRef.current = id;
    subscribe(id, setDl);
  };

  const onLoaded = () => setLoadState('ready');
  const onError = (msg) => { setLoadState('error'); setErrorMsg(msg); };

  return (
    <div
      role="dialog" aria-modal="true" aria-label={t('filePreview.title')} data-testid="file-preview"
      style={{
        position: 'fixed', inset: 0, zIndex: 'var(--z-top)', background: 'rgba(0,0,0,.85)',
        display: 'flex', flexDirection: 'column', animation: 'fadeIn .18s ease-out',
      }}
    >
      {/* 顶部栏：返回 + 文件名 + 更多(下载) */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
        background: 'rgba(0,0,0,.5)', color: '#fff', flexShrink: 0,
      }}>
        <button onClick={onClose} aria-label={t('common.back')} data-testid="file-preview-close"
          style={{ border: 'none', background: 'transparent', color: '#fff', fontSize: 20, cursor: 'pointer', padding: 4 }}>
          ‹
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{filename}</div>
          {fileSize ? <div style={{ fontSize: 12, opacity: .7 }}>{humanSize(fileSize)}</div> : null}
        </div>
        {canShare() && (
          <button onClick={() => shareMessage({ fileUrl: url, filename, title: filename })} aria-label={t('filePreview.share')}
            style={{ border: 'none', background: 'transparent', color: '#fff', fontSize: 14, cursor: 'pointer', padding: 4 }}>
            {t('filePreview.share')}
          </button>
        )}
      </div>

      {/* 主体 */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', background: kind === 'generic' ? 'transparent' : '#525659' }}>
        {loadState === 'loading' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
            正在加载文档…
          </div>
        )}
        {loadState === 'error' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
            <div>{t('filePreview.cannotPreviewTemplate').replace('{error}', errorMsg)}</div>
            <button onClick={startSave} style={{ ...actionBtnStyle }}>{t('filePreview.downloadThenOpenElsewhere')}</button>
          </div>
        )}
        <div style={{ display: loadState === 'ready' ? 'block' : 'none', width: '100%', height: '100%' }}>
          {kind === 'pdf' && <PdfRenderer url={url} onLoaded={onLoaded} onError={onError} />}
          {kind === 'docx' && <DocxRenderer url={url} onLoaded={onLoaded} onError={onError} />}
          {kind === 'xlsx' && <XlsxRenderer url={url} onLoaded={onLoaded} onError={onError} />}
          {kind === 'pptx' && <PptxRenderer url={url} onLoaded={onLoaded} onError={onError} />}
          {kind === 'text' && <TextRenderer url={url} filename={filename} onLoaded={onLoaded} onError={onError} />}
        </div>
        {/* 提前触发不支持格式的 onLoaded 路径（kind==='generic' 已在 effect 里处理），这里渲染详情页内容 */}
        {kind === 'generic' && loadState === 'ready' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 16, color: '#fff', padding: 24,
          }}>
            <svg viewBox="0 0 24 24" style={{ width: 64, height: 64, fill: 'rgba(255,255,255,.85)' }}>
              <path d={iconFor('generic')} />
            </svg>
            <div style={{ fontSize: 16, fontWeight: 500, textAlign: 'center', wordBreak: 'break-all' }}>{filename}</div>
            <div style={{ fontSize: 13, opacity: .7 }}>{humanSize(fileSize)}{mimeType ? ` · ${mimeType}` : ''}</div>
            <div style={{ fontSize: 13, opacity: .6, textAlign: 'center', maxWidth: 280 }}>
              该文件格式暂不支持在投聊内直接预览，可以下载保存，或下载后选择用其他应用打开。
            </div>
          </div>
        )}
      </div>

      {/* 底部操作条：下载/保存进度 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        padding: '14px 16px', background: 'rgba(0,0,0,.5)', flexShrink: 0,
      }}>
        {!dl && (
          <button onClick={startSave} data-testid="file-preview-download" style={actionBtnStyle}>
            {kind === 'generic' ? '下载 / 用其他应用打开' : '保存到本地'}
          </button>
        )}
        {dl && dl.status === 'downloading' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fff', fontSize: 13 }}>
            <div style={{ width: 140, height: 6, background: 'rgba(255,255,255,.25)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${dl.progress || 0}%`, height: '100%', background: 'var(--brand-primary, #07C160)', transition: 'width .2s' }} />
            </div>
            <span>{dl.indeterminate ? '下载中…' : `${dl.progress || 0}%`}</span>
            <button onClick={() => cancelDownload(dlIdRef.current)} style={linkBtnStyle}>{t('common.cancel')}</button>
          </div>
        )}
        {dl && dl.status === 'completed' && <div style={{ color: '#fff', fontSize: 13 }}>{t('filePreview.saved')}</div>}
        {dl && dl.status === 'cancelled' && (
          <button onClick={startSave} style={actionBtnStyle}>{t('filePreview.cancelledRedownload')}</button>
        )}
        {dl && dl.status === 'failed' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fff', fontSize: 13 }}>
            <span>{t('filePreview.downloadFailed')}</span>
            <button onClick={() => retryDownload(dlIdRef.current)} style={linkBtnStyle}>{t('filePreview.retry')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

const actionBtnStyle = {
  border: 'none', cursor: 'pointer', color: '#fff', fontSize: 14,
  background: 'rgba(255,255,255,.18)', padding: '8px 20px', borderRadius: 20,
};
const linkBtnStyle = { border: 'none', background: 'transparent', color: 'var(--brand-primary, #07C160)', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' };
