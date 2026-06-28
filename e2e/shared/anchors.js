/**
 * 测试锚点字典 —— 四端唯一真相源。
 * Web data-testid / Android testTag / iOS accessibilityIdentifier 的值【完全相同】，
 * 使同一份 test case 跨四端共享。动态项是函数(传 id 拼后缀)。
 *
 * 生成 appium/anchors.py 镜像：node e2e/shared/gen-anchors-py.js
 */
'use strict';

const A = {
  // ── 认证 ──
  loginPhone:        'login-phone-input',
  loginPassword:     'login-password-input',
  loginSubmit:       'login-submit-btn',
  authError:         'auth-error-text',
  registerUsername:  'register-username-input',
  registerPhone:     'register-phone-input',
  registerPassword:  'register-password-input',
  registerInvite:    'register-invite-input',
  registerSubmit:    'register-submit-btn',

  // ── 导航 ──
  navTab:            (key) => `nav-tab-${key}`,   // chats|contacts|moments|me
  accountSwitcher:   'account-switcher',
  accountLogout:     'account-logout-btn',

  // ── 会话列表 ──
  convList:          'conv-list',
  convItem:          (convId) => `conv-item-${convId}`,
  convItemName:      'conv-item-name',
  convUnreadBadge:   'conv-unread-badge',

  // ── 聊天页 ──
  chatTitle:         'chat-title',
  chatMsgInput:      'chat-msg-input',
  chatSendBtn:       'chat-send-btn',
  chatAttachImage:   'chat-attach-image',
  chatAttachFile:    'chat-attach-file',
  chatVoiceBtn:      'chat-voice-btn',
  chatMoreBtn:       'chat-more-btn',
  chatCallAudioBtn:  'chat-call-audio-btn',
  chatCallVideoBtn:  'chat-call-video-btn',
  msgBubble:         (msgId) => `msg-bubble-${msgId}`,
  msgBubbleText:     'msg-bubble-text',
  msgEditedFlag:     'msg-edited-flag',
  msgRecalled:       'msg-recalled',
  msgReplyPreview:   'msg-reply-preview',
  msgReadStatus:     'msg-read-status',
  msgImage:          'msg-image',
  // 右键/长按消息菜单项
  ctxEdit:           'ctx-edit',
  ctxRecall:         'ctx-recall',
  ctxReply:          'ctx-reply',
  ctxForward:        'ctx-forward',
  // 确认弹窗
  confirmOk:         'confirm-ok',
  confirmCancel:     'confirm-cancel',

  // ── 灯箱 ──
  lightbox:          'lightbox',
  lightboxImage:     'lightbox-image',
  lightboxPrev:      'lightbox-prev',
  lightboxNext:      'lightbox-next',
  lightboxClose:     'lightbox-close',

  // ── 群 ──
  groupCreateBtn:    'group-create-btn',
  groupConfirmBtn:   'group-confirm-btn',
  groupNameInput:    'group-name-input',
  groupRenameSave:   'group-rename-save',
  groupMemberRemove: (userId) => `group-member-remove-${userId}`,
  groupLeaveBtn:     'group-leave-btn',

  // ── 通话 ──
  callModal:         'call-modal',
  callAcceptBtn:     'call-accept-btn',
  callRejectBtn:     'call-reject-btn',
  callHangupBtn:     'call-hangup-btn',
};

module.exports = A;
