'use strict';
const router = require('express').Router();
const documents = require('./documents');
router.get('/:kind', (req,res) => {
  const kind = req.params.kind;
  if (!['privacy','terms'].includes(kind)) return res.status(404).json({error:'文档不存在'});
  if (req.query.version && req.query.version !== documents.version) return res.status(409).json({error:'文档版本已更新，请重新阅读'});
  res.set('Cache-Control','no-store');
  const text = documents[kind];
  if (req.query.format === 'html') {
    const escape = value => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    return res.type('html').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${kind === 'privacy' ? '隐私政策' : '用户协议'}</title><body><main><pre style="white-space:pre-wrap;max-width:850px;margin:24px auto;font:16px/1.8 sans-serif">${escape(text)}</pre></main></body></html>`);
  }
  res.json({version:documents.version,text});
});
module.exports = router;
