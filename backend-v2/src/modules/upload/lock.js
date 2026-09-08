'use strict';
const path = require('path');
const lockfile = require('proper-lockfile');
// Heartbeat prevents an active finish/hash operation expiring; dead processes recover after 30s.
function withUploadLock(directory, handler) {
  return async (req, res) => {
    const id = req.params.uploadId;
    if (typeof id !== 'string' || !/^[0-9a-f]{40}$/.test(id)) return res.status(400).json({ error: '无效的上传ID' });
    let release;
    try { release = await lockfile.lock(path.join(directory,id), { realpath:false, stale:30000, update:5000, retries:0 }); }
    catch (e) { if (e.code === 'ELOCKED') return res.status(409).json({ error: '上传正在处理中，请查询状态后重试' }); throw e; }
    try { return await handler(req, res); }
    finally { await release(); }
  };
}
module.exports = { withUploadLock };
