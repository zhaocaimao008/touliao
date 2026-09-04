'use strict';
/**
 * 推送文案多语言。
 *
 * 为什么需要它：前端有 zh-CN / en / zh-TW 三套共 1000+ 键的完整词典，但推送文案
 * 一直写死在服务端的简体中文里（'新消息' / '收到一条新消息' / '[图片]' …）。
 * 推送是用户在 App 之外唯一能看到的文案，英文用户锁屏上收到的却全是简体中文——
 * 前端做的整套 i18n 到这一步全部丢失。
 *
 * 语言来源：user_settings.lang（客户端切换语言时上报，默认 zh-CN）。
 * 服务端不做协商猜测——推送是异步发出的，没有请求上下文里的 Accept-Language 可用。
 *
 * 词典有意保持极小：只覆盖推送真正会用到的几条。新增语言只需加一个键，
 * 缺键自动回落 zh-CN，绝不会推出一条空文案。
 */

const DEFAULT_LANG = 'zh-CN';

const dict = {
  'zh-CN': {
    'push.newMessage':   '新消息',
    'push.oneNewMessage': '收到一条新消息',
    'type.image':        '[图片]',
    'type.voice':        '[语音]',
    'type.file':         '[文件]',
    'type.video':        '[视频]',
    'type.location':     '[位置]',
    'type.redPacket':    '[红包] 恭喜发财',
    'type.contactCard':  '[名片]',
    // 来电
    'call.title':        '来电',
    'call.video':        '邀请你视频通话',
    'call.audio':        '邀请你语音通话',
    // 好友申请
    'friend.request':    '请求添加你为好友',
    'friend.someone':    '有人',
    // 朋友圈互动
    'moment.title':      '朋友圈',
    'moment.liked':      '{name} 赞了你的朋友圈',
    'moment.commented':  '{name} 评论了你的朋友圈',
  },
  en: {
    'push.newMessage':   'New message',
    'push.oneNewMessage': 'You have a new message',
    'type.image':        '[Photo]',
    'type.voice':        '[Voice]',
    'type.file':         '[File]',
    'type.video':        '[Video]',
    'type.location':     '[Location]',
    'type.redPacket':    '[Red packet] Best wishes',
    'type.contactCard':  '[Contact]',
    'call.title':        'Incoming call',
    'call.video':        'is inviting you to a video call',
    'call.audio':        'is inviting you to a voice call',
    'friend.request':    'wants to add you as a friend',
    'friend.someone':    'Someone',
    'moment.title':      'Moments',
    'moment.liked':      '{name} liked your moment',
    'moment.commented':  '{name} commented on your moment',
  },
  'zh-TW': {
    'push.newMessage':   '新訊息',
    'push.oneNewMessage': '收到一則新訊息',
    'type.image':        '[圖片]',
    'type.voice':        '[語音]',
    'type.file':         '[檔案]',
    'type.video':        '[影片]',
    'type.location':     '[位置]',
    'type.redPacket':    '[紅包] 恭喜發財',
    'type.contactCard':  '[名片]',
    'call.title':        '來電',
    'call.video':        '邀請你視訊通話',
    'call.audio':        '邀請你語音通話',
    'friend.request':    '請求加你為好友',
    'friend.someone':    '有人',
    'moment.title':      '朋友圈',
    'moment.liked':      '{name} 讚了你的朋友圈',
    'moment.commented':  '{name} 評論了你的朋友圈',
  },
};

const SUPPORTED_LANGS = Object.keys(dict);

/** 归一化语言码：不认识的一律回落 zh-CN（含 null/空串/被篡改的值） */
function normalizeLang(lang) {
  return SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;
}

/** 取词。缺键先回落 zh-CN，再回落 key 本身（保证永不返回 undefined） */
function t(lang, key) {
  const l = normalizeLang(lang);
  return dict[l][key] ?? dict[DEFAULT_LANG][key] ?? key;
}

/**
 * 按消息类型生成推送正文。
 * 纯文本消息直接用内容截断；带附件的消息用本地化的类型占位符。
 */
function bodyForMessage(lang, type, content) {
  switch (type) {
    case 'image':        return t(lang, 'type.image');
    case 'voice':        return t(lang, 'type.voice');
    case 'video':        return t(lang, 'type.video');
    case 'file':         return `${t(lang, 'type.file')} ${(content || '').slice(0, 50)}`;
    case 'location':     return t(lang, 'type.location');
    case 'red_packet':   return t(lang, 'type.redPacket');
    case 'contact_card': return t(lang, 'type.contactCard');
    default:             return content?.slice(0, 100) || '';
  }
}

/** 取词并替换 {name} 之类的占位符 */
function tf(lang, key, vars = {}) {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.split(`{${k}}`).join(String(v)),
    t(lang, key)
  );
}

module.exports = { t, tf, bodyForMessage, normalizeLang, SUPPORTED_LANGS, DEFAULT_LANG };
