'use strict';
// 自 f13-report-moderation 迁出（举报功能已于 2026-09-26 移除，媒体审核兜底语义保留）。
test('missing image moderation never claims approval', async () => {
  const Moderator = require('../src/utils/contentModerator');
  expect(await new Moderator().moderateImage('synthetic-local-image')).toEqual({status:'unavailable',reason:'MEDIA_MODERATION_UNAVAILABLE'});
});
