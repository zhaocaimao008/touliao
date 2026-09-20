import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { createPortal } from 'react-dom';
import './Safety.css';

export default function LegalConsent({ value, onChange }) {
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all(['privacy', 'terms'].map(kind => axios.get(`/api/legal/${kind}`)))
      .then(([privacy, terms]) => {
        if (!active) return;
        if (!privacy.data.version || !terms.data.version || !privacy.data.text || !terms.data.text) throw new Error('invalid documents');
        setDocuments({ privacy: privacy.data, terms: terms.data }); setError('');
      }).catch(() => { if (active) setError('政策加载失败，请重试'); });
    return () => { active = false; };
  }, [attempt]);
  return <div className="safety-links">
    <button type="button" onClick={() => setOpened('privacy')}>隐私政策</button>
    <button type="button" onClick={() => setOpened('terms')}>用户协议</button>
    {onChange && <label><input type="checkbox" aria-label="同意隐私政策和用户协议" checked={value?.accepted === true} disabled={!documents}
      onChange={e => onChange({ accepted: e.target.checked, privacyVersion: documents.privacy.version, termsVersion: documents.terms.version })} />我已阅读并同意隐私政策和用户协议</label>}
    {error && <span role="alert">{error} <button type="button" onClick={() => setAttempt(n => n + 1)}>重新加载</button></span>}
    {opened && createPortal(<div className="safety-overlay"><section className="safety-dialog" role="dialog" aria-modal="true" aria-label={opened === 'privacy' ? '隐私政策' : '用户协议'}>
      <button type="button" onClick={() => setOpened(null)}>关闭</button>
      <div style={{ whiteSpace: 'pre-wrap' }}>{documents?.[opened]?.text || error || '加载中…'}</div>
    </section></div>, document.body)}
  </div>;
}
