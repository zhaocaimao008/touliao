import React, { useEffect, useRef, useState } from 'react';
import TouliaoIcon from '../ui-kit/Icon';
import { useI18n } from '../contexts/I18nContext';
import { resolveMediaUrl } from '../utils/url';
import { csvRows } from '../utils/csvRows';
import { extOf } from '../utils/attachmentType';

// Each attempt owns its fetch, renderer and callbacks. Closing or switching a
// file aborts the request and makes all late parse/render completions inert.
export function DocumentRenderer({ fileUrl, kind, filename, onLoaded, onError }) {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const wordHost = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    const active = () => !controller.signal.aborted;
    (async () => {
      try {
        const url = await resolveMediaUrl(fileUrl);
        if (!active()) return;
        if (!url) throw new Error('Missing file');
        const response = await fetch(url, { credentials: 'include', signal: controller.signal });
        if (!response.ok) throw new Error('File request failed');
        let result;
        if (kind === 'text') result = await response.text();
        else {
          const bytes = await response.arrayBuffer();
          if (!active()) return;
          if (kind === 'docx') {
            const { renderAsync } = await import('docx-preview');
            if (!active() || !wordHost.current) return;
            await renderAsync(bytes, wordHost.current, undefined, { className: 'wc-docx', inWrapper: true, ignoreWidth: false, ignoreHeight: false });
          } else if (kind === 'xlsx') {
            const [XLSX, { default: DOMPurify }] = await Promise.all([import('xlsx'), import('dompurify')]);
            if (!active()) return;
            const workbook = XLSX.read(bytes, { type: 'array' });
            result = workbook.SheetNames.map(name => ({ name,
              html: DOMPurify.sanitize(XLSX.utils.sheet_to_html(workbook.Sheets[name], { editable: false })),
            }));
          } else if (kind === 'pptx') {
            const { default: JSZip } = await import('jszip');
            if (!active()) return;
            const zip = await JSZip.loadAsync(bytes);
            if (!active()) return;
            const files = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
              .sort((a,b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));
            result = [];
            for (const name of files) {
              const xml = await zip.files[name].async('text');
              if (!active()) return;
              const doc = new DOMParser().parseFromString(xml, 'application/xml');
              result.push(Array.from(doc.getElementsByTagName('a:t')).map(node => node.textContent).filter(Boolean));
            }
          }
        }
        if (!active()) return;
        setData(result);
        onLoaded();
      } catch { if (active()) onError(); }
    })();
    return () => controller.abort();
  }, [fileUrl, kind, onLoaded, onError]);

  if (kind === 'docx') return <div ref={wordHost} className="file-document-scroll file-document-word" />;
  if (kind === 'xlsx') return <div className="file-document-workbook">
    {data?.length > 1 && <div className="file-sheet-tabs" role="group" aria-label={t('filePreview.sheets')}>
      {data.map((sheet, index) => <button key={sheet.name} type="button" aria-pressed={index === activeSheet}
        onClick={() => setActiveSheet(index)}>{sheet.name}</button>)}
    </div>}
    <div className="file-document-scroll wc-xlsx-table-wrap" dangerouslySetInnerHTML={{ __html: data?.[activeSheet]?.html || '' }} />
  </div>;
  if (kind === 'pptx') return <div className="file-document-scroll file-document-slides">
    <p className="file-document-notice">{t('filePreview.pptxSimplifiedNotice')}</p>
    {data?.map((texts,index) => <section className="file-document-slide" key={index}>
      <h3>{t('filePreview.pageTemplate').replace('{n}',index + 1)}</h3>
      {texts.length ? texts.map((text,i) => <p key={i}>{text}</p>) : <p>{t('filePreview.pptxNoTextContent')}</p>}
    </section>)}
  </div>;
  if (extOf(filename) === 'csv') return <div className="file-document-scroll file-document-csv"><table><tbody>
    {csvRows(data).map((row,i) => <tr key={i}>{row.map((cell,j) => <td key={j}>{cell}</td>)}</tr>)}
  </tbody></table></div>;
  return <pre className="file-document-scroll file-document-text">{data}</pre>;
}

export function PdfRenderer({ fileUrl, onLoaded, onError }) {
  const { t } = useI18n();
  const [doc, setDoc] = useState(null);
  const [scale, setScale] = useState(1);
  const scrollRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    let task;
    (async () => {
      try {
        const [pdf, worker, url] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url'), resolveMediaUrl(fileUrl)]);
        if (cancelled) return;
        if (!url) throw new Error('Missing file');
        pdf.GlobalWorkerOptions.workerSrc = worker.default;
        task = pdf.getDocument({ url, withCredentials: true });
        const document = await task.promise;
        if (cancelled) return;
        setDoc(document);
      } catch { if (!cancelled) onError(); }
    })();
    return () => { cancelled = true; Promise.resolve(task?.destroy()).catch(() => {}); };
  }, [fileUrl, onError]);

  return <div className="file-document-pdf">
    <div className="file-document-scroll file-pdf-pages" ref={scrollRef}>
      {doc && Array.from({ length: doc.numPages }, (_,index) => <PdfPage key={index}
        doc={doc} number={index + 1} scale={scale} scrollRef={scrollRef}
        onLoaded={index === 0 ? onLoaded : undefined} onError={onError} />)}
    </div>
    <div className="file-pdf-zoom" role="group" aria-label={t('filePreview.pdfZoom')}>
      <button type="button" disabled={scale <= 0.5} aria-label={t('imagePreview.zoomOut')} onClick={() => setScale(value => Math.max(0.5,value - 0.25))}><TouliaoIcon name="minimize" size="sm" /></button>
      <button type="button" onClick={() => setScale(1)} aria-label={t('imagePreview.resetZoom')}>{Math.round(scale * 100)}%</button>
      <button type="button" disabled={scale >= 3} aria-label={t('imagePreview.zoomIn')} onClick={() => setScale(value => Math.min(3,value + 0.25))}><TouliaoIcon name="add" size="sm" /></button>
    </div>
  </div>;
}

export function PdfPage({ doc, number, scale, scrollRef, onLoaded, onError }) {
  const { t } = useI18n();
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(number === 1);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const measure = () => setWidth(Math.max(1, root.clientWidth - 24));
    measure();
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    resize?.observe(root);
    window.addEventListener('resize', measure);
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      setVisible(number === 1 || entries.some(entry => entry.isIntersecting));
    }, { root, rootMargin: '600px 0px' }) : null;
    if (observer) observer.observe(hostRef.current);
    else setVisible(true);
    return () => { resize?.disconnect(); observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [scrollRef, number]);
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!visible || !width || !canvas) return;
    let cancelled = false;
    let renderTask;
    (async () => {
      try {
        const page = await doc.getPage(number);
        if (cancelled) return;
        const natural = page.getViewport({ scale: 1 });
        const fit = Math.min(1, width / natural.width) * scale;
        const css = page.getViewport({ scale: fit });
        // Bound raster size while keeping CSS zoom; release offscreen canvases.
        const density = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(css.width,css.height));
        const viewport = page.getViewport({ scale: fit * density });
        host.style.minHeight = `${css.height}px`;
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${css.width}px`; canvas.style.height = `${css.height}px`;
        renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
        await renderTask.promise;
        if (!cancelled) onLoaded?.();
      } catch { if (!cancelled) onError(); }
    })();
    return () => { cancelled = true; renderTask?.cancel(); canvas.width = 0; canvas.height = 0; };
  }, [doc, number, scale, width, visible, onLoaded, onError]);
  return <div className="file-pdf-page" ref={hostRef} aria-label={t('filePreview.pageTemplate').replace('{n}',number)}>
    <canvas key={JSON.stringify([scale, width, visible])} ref={canvasRef} width={0} height={0} />
  </div>;
}
