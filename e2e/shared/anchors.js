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
  accountRow:        (id) => `account-row-${id}`,   // 账户面板某账号行(点切换)
  accountAddRow:     'account-add-row',              // "添加账户"展开
  accountAddPhone:   'account-add-phone',
  accountAddPassword:'account-add-password',
  accountAddSubmit:  'account-add-submit',

  // ── 会话列表 ──
  convList:          'conv-list',
  convItem:          (convId) => `conv-item-${convId}`,
  convItemName:      'conv-item-name',
  convItemDraft:     'conv-item-draft',
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
  msgSendFailed:     'msg-send-failed',   // 发送失败/重发态(❗)
  msgImage:          'msg-image',
  msgFile:           'msg-file',          // 文件消息气泡
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
  addMenuBtn:        'add-menu-btn',      // 顶部 + 添加菜单
  createGroupEntry:  'create-group-entry',// "发起群聊"菜单项
  groupNameInput:    'group-name-input',   // 建群:群名输入
  groupMemberRow:    (userId) => `group-member-row-${userId}`, // 建群:成员勾选行
  groupCreateBtn:    'group-create-btn',   // 建群:创建按钮
  groupInfoBtn:      'chat-group-info-btn',// 聊天顶栏:打开群信息/更多
  groupConfirmBtn:   'group-confirm-btn',
  groupRenameInput:  'group-rename-input', // 群信息:改名输入
  groupRenameSave:   'group-rename-save',  // 群信息:保存群名
  groupMemberRemove: (userId) => `group-member-remove-${userId}`,
  groupLeaveBtn:     'group-leave-btn',    // 群信息:退群(成员)
  groupDissolveBtn:  'group-dissolve-btn', // 群信息:解散(群主)——群主无退群按钮

  // ── 通话 ──
  callModal:         'call-modal',
  callAcceptBtn:     'call-accept-btn',
  callRejectBtn:     'call-reject-btn',
  callHangupBtn:     'call-hangup-btn',
};

module.exports = A;
