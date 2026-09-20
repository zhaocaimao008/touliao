'use strict';
const path = require('path');
const { ApiError } = require('../../utils/http');
const visualExtensions = new Set('jpg jpeg jpe png gif webp bmp avif heic heif tif tiff svg ico mp4 m4v mov webm mkv avi wmv flv mpg mpeg 3gp 3g2 ogv'.split(' '));
// No verified provider is configured. Do not fabricate a safe verdict or let a
// client-selected MIME/extension turn an unreviewed image into a document.
function assertMediaAvailable({mime='',filename='',detectedMime=''}={}) {
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (/^(image|video)\//i.test(mime) || /^(image|video)\//i.test(detectedMime) || visualExtensions.has(ext)) {
    throw unavailable();
  }
}
function unavailable() {
  return new ApiError(503,'图片/视频审核服务尚不可用，上传已暂停；请通过举报与客服联系管理员','MEDIA_MODERATION_UNAVAILABLE');
}
async function assertUploadAvailable(filePath,filename,mime,detectedMime) {
  if (mime.split(';')[0].trim().toLowerCase()==='audio/webm' && detectedMime==='video/webm'
      && path.extname(filename).toLowerCase()==='.webm'
      && await require('./audioContainer').isAudioOnlyWebm(filePath)) return;
  assertMediaAvailable({mime,filename,detectedMime});
}
function assertCloudUploadAvailable() { throw unavailable(); }
module.exports = { assertMediaAvailable, assertUploadAvailable, assertCloudUploadAvailable, unavailable };
