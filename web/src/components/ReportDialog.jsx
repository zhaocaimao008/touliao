import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { createPortal } from 'react-dom';
import './Safety.css';
import { useAuth } from '../contexts/AuthContext';
export const reportStatus = { pending: '待受理', reviewing: '处理中', resolved: '已处理', dismissed: '已驳回' };
export function ReportDialog({ targetType = 'support', targetId = 'support', onClose }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const inFlight = useRef(false);
  const load = async (start = 0) => {
    try {
      const { data } = await axios.get('/api/reports', { params: { offset: start, limit: 30 } });
      setItems(data.items); setHasMore(data.hasMore); setOffset(start); setError('');
    } catch (e) { setError(e.response?.data?.error || '状态加载失败，请重试'); }
  };
  useEffect(() => { (async () => { await load(); })(); }, []);
  const submit = async e => {
    e.preventDefault();
    if (inFlight.current || !reason.trim()) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const { data } = await axios.post('/api/reports', { targetType, targetId, reason: reason.trim() }, { skipRetry: true });
      if (!data.id || !data.status) throw new Error('invalid receipt');
      setReceipt(data); setReason(''); await load();
    } catch (e) { setError(e.response?.data?.error || '提交失败，请重试'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <section className="safety-dialog" role="dialog" aria-modal="true" aria-label="举报与客服">
    <button type="button" onClick={onClose}>关闭</button><h2>{targetType === 'support' ? '举报与客服' : '举报'}</h2>
    <p>请说明问题。处理进度与回复可在本页查看。独立邮箱/电话及处理时限待运营方提供。</p>
    <form onSubmit={submit}><label>问题或举报理由<textarea aria-label="问题或举报理由" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button type="submit" disabled={busy || !reason.trim()}>提交</button></form>
    {error && <p role="alert">{error}</p>}
    {receipt && <p role="status">工单 {receipt.id}：{reportStatus[receipt.status] || receipt.status}</p>}
    <h3>我的工单</h3><button type="button" onClick={() => load(offset)}>刷新状态</button>
    {items.map(item => <article key={item.id}><b>{item.id} · {reportStatus[item.status] || item.status}</b><p>{item.reason}</p><p>{item.resolution || '等待管理员处理'}</p></article>)}
    <button type="button" disabled={offset === 0} onClick={() => load(Math.max(0, offset - 30))}>上一页</button>
    <button type="button" disabled={!hasMore} onClick={() => load(offset + 30)}>下一页</button>
  </section>;
}
export default function ReportButton({ targetType, targetId, label = '举报' }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={e => { e.stopPropagation(); setOpen(true); }}>{label}</button>
    {open && createPortal(<div className="safety-overlay" onClick={e => e.stopPropagation()}><ReportDialog key={user?.id || 'signed-out'} targetType={targetType} targetId={targetId} onClose={() => setOpen(false)} /></div>, document.body)}</>;
}
