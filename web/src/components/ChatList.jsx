import TouliaoIcon from '../ui-kit/Icon';
import { useChatDrafts } from '../hooks/useChatDrafts';
import React, { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import { GroupAvatar } from './GroupAvatar';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { format } from '../utils/time';
import { showConfirm, showToast } from '../utils/toast';
import { useI18n } from '../contexts/I18nContext';
import { FixedSizeList } from 'react-window';
import { createPortal } from 'react-dom';
import AutoSizer from 'react-virtualized-auto-sizer';
import { archiveUnreadTotal, splitArchivedConversations } from '../utils/archiveConversations';
import { useSwipe } from '../hooks/useSwipe';
import { EmptyState } from './StateViews';
import designTokens from '../ui-kit/tokens.json';
import { groupSystemPreview } from '../utils/groupSystemText';
import { applyConversationSettings, publishConversationSettings, subscribeConversationSettings } from '../utils/conversationSettings';
import { captureSession, isSessionCurrent } from '../utils/sessionContext';

const rowHeight = () => window.innerWidth < designTokens.layout.breakpoints.compactDesktopMin
  ? designTokens.components.listRow.mobileMinimum : designTokens.components.listRow.desktopMinimum;

// 会话排序：置顶优先，其次按最新消息时间倒序（多处 setState 复用，避免逻辑漂移）
const byPinnedThenTime = (a, b) =>
  ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || ((b.lastTime || 0) - (a.lastTime || 0));

// Stable module-level row component so react-window doesn't unmount on re-render
const ConvRow = memo(function ConvRow({ index, style, data }) {
  const { t } = useI18n();
  const { items, activeConvId, onSelectConv, onCtxMenu, previewMsg, user, drafts, onPin, onDelete } = data;
  const conv = items[index];
  const count = conv._unread || 0;
  const draft = (drafts && drafts[conv.id]) || '';
  // 左滑快捷操作（仅触屏）：置顶 / 删除。桌面端走右键菜单，不在 hover 时平移整行
  // （平移会遮住名字/时间，还把「删除」按钮常驻暴露在鼠标下）。
  const { swipeOffset, swipeHandlers, resetSwipe, swipeEnabled } = useSwipe({ maxOffset: 144, allowRight: false });
  const revealed = swipeOffset !== 0;
  const handleSwipePin = () => { resetSwipe(); onPin?.(conv, !conv.pinned); };
  const handleSwipeDelete = () => { resetSwipe(); onDelete?.(conv); };
  return (
    // react-window 的 style 自带 position:absolute + top，不能覆盖成 relative，
    // 否则每行既在文档流里占位又叠加 top 偏移，行距翻倍（2026-09-26 回归）。
    <div className="wc-chat-item-wrapper" style={{ ...style, overflow: 'hidden' }}>
      {/* 左滑露出的快捷按钮；未滑动时隐藏，避免透明行背景下透出 */}
      <div className="wc-chat-item-swipe-actions" aria-hidden={!revealed} style={revealed ? undefined : { visibility: 'hidden' }}>
        <button type="button" className="wc-swipe-btn wc-swipe-pin" onClick={handleSwipePin} tabIndex={revealed ? 0 : -1}>
          {conv.pinned ? t('chatlist.unpinChat') : t('chatlist.pinChat')}
        </button>
        <button type="button" className="wc-swipe-btn wc-swipe-delete" onClick={handleSwipeDelete} tabIndex={revealed ? 0 : -1}>
          {conv.type === 'group' ? t('chatlist.leaveGroup') : t('chatlist.deleteChat')}
        </button>
      </div>
      <div
        data-testid={`conv-item-${conv.id}`}
        className={`wc-chat-item${conv.id === activeConvId ? ' active' : ''}${conv.pinned ? ' pinned' : ''}`}
        onClick={() => { if (swipeOffset !== 0) { resetSwipe(); return; } onSelectConv(conv); }}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelectConv(conv))}
        role="button"
        tabIndex={0}
        aria-current={conv.id === activeConvId ? 'true' : undefined}
        onContextMenu={e => {
          e.preventDefault();
          // 视口内收敛坐标，避免菜单在靠近右/下边缘时溢出屏幕外
          // 与 index.css .wc-ctx-menu 的 width:260px 一致；高度按 5 项估算，渲染后再按实测尺寸校正
          const MENU_W = 268, MENU_H = 250;
          const x = Math.min(e.clientX, window.innerWidth - MENU_W);
          const y = Math.min(e.clientY, window.innerHeight - MENU_H);
          onCtxMenu({ x: Math.max(8, x), y: Math.max(8, y), conv });
        }}
        style={{
          background: conv.pinned && conv.id !== activeConvId ? 'var(--bg-pinned)' : undefined,
          ...(revealed ? { transform: `translateX(${swipeOffset}px)` } : {}),
        }}
        {...(swipeEnabled ? swipeHandlers : {})}
      >
        <div className="wc-chat-item-avatar">
          {conv.type === 'group'
            ? <GroupAvatar members={conv.members || []} avatar={conv.avatar} size='md' />
            : <Avatar src={conv.avatar} name={conv.name} size='md' />
          }
          {count > 0 && <span className={`wc-chat-item-badge${conv.muted ? ' muted' : ''}`}>{count > 99 ? '99+' : count}</span>}
          {count === 0 && !!conv.manually_unread && <span className="wc-chat-item-unread-dot" />}
        </div>
        <div className="wc-chat-item-info">
          <div className="wc-chat-item-row1">
            <span className="wc-chat-item-name" data-testid="conv-item-name">{conv.name || (conv.type === 'private' ? t('chatlist.deletedUser') : t('chatlist.unknown'))}</span>
            <span className="wc-chat-item-time">{conv.lastTime ? format(conv.lastTime * 1000) : ''}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            {!!conv.muted && (
              <TouliaoIcon name="mute" style={{flexShrink:0,color:'var(--text-tertiary)'}} size="xs" />
            )}
            <span className="wc-chat-item-preview">
              {draft
                ? <><span className="wc-chat-item-draft" data-testid="conv-item-draft">{t('chatlist.draftTag')}</span>{draft}</>
                : <>{conv.hasMention && <span className="wc-chat-item-mention">{t('chatlist.mentionTag')}</span>}{previewMsg(conv, user, t)}</>}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}, (prev, next) => {
  const pi = prev.data.items[prev.index];
  const ni = next.data.items[next.index];
  return pi === ni && prev.data.activeConvId === next.data.activeConvId && prev.style.top === next.style.top && prev.style.height === next.style.height && pi?.manually_unread === ni?.manually_unread
    && (prev.data.drafts?.[pi?.id] || '') === (next.data.drafts?.[ni?.id] || '');
});

function previewMsg(conv, user, t) {
  const mt = conv.lastMessageType;
  if (mt === 'image') return t('chatlist.previewImage');
  if (mt === 'voice') return t('chatlist.previewVoice');
  if (mt === 'video') return t('chatlist.previewVideo');
  if (mt === 'file') return t('chatlist.previewFile');
  if (mt === 'contact_card' || mt === 'contact') return t('chatlist.previewContact');
  if (mt === 'red_packet') return t('chatlist.previewRedPacket');
  if (mt === 'sticker') return t('chatlist.previewSticker');
  if (mt === 'nudge') {
    try {
      const n = JSON.parse(conv.lastMessage);
      const a = String(n.actor) === String(user?.id) ? t('chatlist.you') : (n.actorName || t('chatlist.someone'));
      const b = String(n.target) === String(user?.id) ? t('chatlist.you') : (n.targetName || t('chatlist.someone'));
      return t('chatlist.nudgeTemplate').replace('{a}', a).replace('{b}', b);
    } catch { return t('chatlist.previewNudge'); }
  }
  if (mt === 'system') return groupSystemPreview(conv.lastMessage, user?.username, t);
  if (mt === 'call') {
    // 通话系统消息预览:content 即人话(如「语音通话 30 秒」),直接显示
    return conv.lastMessage || t('chatlist.previewCall');
  }
  if (mt === 'merged') return t('chatlist.previewMerged');
  if (!conv.lastMessage) return '';
  if (conv.type === 'group' && conv.lastSenderName && conv.lastSenderName !== user?.username)
    return `${conv.lastSenderName}: ${conv.lastMessage}`;
  return conv.lastMessage;
}

// 首屏骨架：8 行占位（头像 + 两行文本），shimmer 微光，避免加载时闪「暂无聊天」
function ChatListSkeleton() {
  return (
    <div aria-hidden="true" style={{ padding: '4px 0' }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={`skel-${i}`} className="wc-chat-item" style={{ cursor: 'default' }}>
          <div className="wc-skel wc-skel-avatar" />
          <div className="wc-chat-item-info" style={{ gap: 8 }}>
            <div className="wc-skel wc-skel-line" style={{ width: '42%' }} />
            <div className="wc-skel wc-skel-line" style={{ width: '68%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// 阅后即焚：会话列表预览不透出原文（与服务端列表/推送同口径），否则不点开就能读到内容
// 通话消息 content 是主叫文案；被叫的预览换成被叫视角（与服务端会话列表同口径）
const CALLEE_CALL_TEXT = { '对方已拒绝': '已拒绝', '已取消': '未接来电', '对方无应答': '未接来电' };
const previewOf = (msg, myId) => {
  if (msg.burn_after > 0) return '[阅后即焚消息]';
  if (msg.type === 'call' && String(msg.sender_id) !== String(myId)) return CALLEE_CALL_TEXT[msg.content] || msg.content;
  return msg.content;
};

export default function ChatList({ onSelectConv, activeConvId, unread = {}, searchQuery = '', convRefreshKey = 0, onOpenMentions, onMutedChange }) {
  const [itemHeight, setItemHeight] = useState(rowHeight);
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    const resize = () => setItemHeight(rowHeight());
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const { t } = useI18n();
  const [conversations, setConversations] = useState([]);
  const [loaded, setLoaded] = useState(false);   // 首屏是否已拉过一次：未拉完显示骨架，避免闪「暂无聊天」
  const [ctxMenu, setCtxMenu] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const { socket, reconnectCount } = useSocket();
  const { user, outboxScope } = useAuth();
  const drafts = useChatDrafts(outboxScope);

  // 右键菜单打开时：Esc 关闭 + 滚动/窗口失焦自动收起(避免菜单悬浮在错位处)
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [ctxMenu]);

  const fetchConvs = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/messages/conversations', { params: { includeArchived: 1 } });
      setConversations(Array.isArray(data) ? data : []);
    } finally {
      setLoaded(true);   // 无论成功失败都结束骨架态，不卡在加载
    }
  }, []);

  const handleSelectConv = useCallback((conv) => {
    if (conv.manually_unread || conv.hasMention) {
      setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, manually_unread: 0, hasMention: false } : c));
    }
    onSelectConv(conv);
  }, [onSelectConv]);

  // 当前打开的会话收到 @ 不打标记（用户正在看）；用 ref 避免每次切会话都重订阅 socket 事件
  // 上报免打扰会话集合（内容不变时不触发父组件更新）
  const mutedKey = useMemo(() => conversations.filter(c => c.muted).map(c => c.id).sort().join(','), [conversations]);
  useEffect(() => { onMutedChange?.(new Set(mutedKey ? mutedKey.split(',') : [])); }, [mutedKey, onMutedChange]);

  const activeConvIdRef = useRef(activeConvId);
  useEffect(() => { activeConvIdRef.current = activeConvId; }, [activeConvId]);

  useEffect(() => { fetchConvs(); }, [fetchConvs]);

  // 重连后刷新会话列表（补回未读数和最新消息预览）
  useEffect(() => {
    if (reconnectCount === 0) return;
    fetchConvs();
  }, [reconnectCount, fetchConvs]);

  // 好友通过 / new_conversation 事件触发时刷新
  useEffect(() => { fetchConvs(); }, [convRefreshKey, fetchConvs]);

  useEffect(() => {
    if (!socket) return;
    const onMsg = (msg) => {
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === msg.conversation_id);
        if (idx === -1) { fetchConvs(); return prev; }
        const updated = [...prev];
        updated[idx] = { ...updated[idx], lastMessage: previewOf(msg, user?.id), lastMessageType: msg.type, lastTime: msg.created_at, lastSenderName: msg.senderName };
        return updated.sort(byPinnedThenTime);
      });
    };
    const onNewConv = (incoming) => {
      // 新会话（刚加的好友/新建的群）还没有消息：按「现在」排序放到顶部，否则 lastTime=0 会沉到列表最底部
      const conv = incoming.lastTime ? incoming : { ...incoming, lastTime: Math.floor(Date.now() / 1000) };
      setConversations(prev => {
        if (prev.find(c => c.id === conv.id)) return prev;
        socket.emit('join_conversation', { conversationId: conv.id });
        return [conv, ...prev].sort(byPinnedThenTime);
      });
      // 推送里的群不带成员头像，先插入占位再补拉一次列表，群头像拼图才不会一直是"群"字
      if (conv.type === 'group' && !conv.members?.length) fetchConvs();
    };
    const onCleared = ({ conversationId }) => {
      setConversations(prev => prev.map(c => c.id === conversationId ? {
        ...c,
        lastMessage: '',
        lastMessageType: '',
        lastTime: 0,
        lastSenderName: '',
        unreadCount: 0,
      } : c));
    };
    // 撤回 / 个人删除：会话列表 preview 可能指向被删消息，重拉列表让
    // last_message 回退到上一条有效消息（服务端 listConversations 已过滤）
    const onDeletedEvt = () => fetchConvs();
    socket.on('message_recall', onDeletedEvt);
    socket.on('message_deleted_for_me', onDeletedEvt);
    socket.on('message_deleted', onDeletedEvt);
    socket.on('message_vanished', onDeletedEvt); // 阅后即焚到期销毁：预览不能停在「[阅后即焚消息]」
    // 群更新（群名/头像/公告等变化时刷新）
    const onGroupUpdated = () => fetchConvs();
    // 被踢出群 / 群解散：从列表中立即移除该会话
    const onGroupKicked    = ({ conversationId }) =>
      setConversations(prev => prev.filter(c => c.id !== conversationId));
    const onGroupDismissed = ({ conversationId }) =>
      setConversations(prev => prev.filter(c => c.id !== conversationId));

    // 批量消息：合并成单次 setState，并且每个未知会话只触发一次 fetchConvs
    const onMsgBatch = (arr) => {
      if (!Array.isArray(arr) || !arr.length) return;
      // 每个会话只保留最新一条消息
      const msgMap = {};
      for (const msg of arr) {
        const cur = msgMap[msg.conversation_id];
        if (!cur || msg.created_at > cur.created_at) msgMap[msg.conversation_id] = msg;
      }
      setConversations(prev => {
        let fetched = false;
        let changed = false;
        const knownIds = new Set(prev.map(c => c.id));
        const next = prev.map(c => {
          const msg = msgMap[c.id];
          if (!msg) return c;
          changed = true;
          return { ...c, lastMessage: previewOf(msg, user?.id), lastMessageType: msg.type, lastTime: msg.created_at, lastSenderName: msg.senderName };
        });
        for (const id of Object.keys(msgMap)) {
          if (!knownIds.has(id) && !fetched) { fetchConvs(); fetched = true; }
        }
        if (!changed) return prev;
        return next.sort(byPinnedThenTime);
      });
    };
    // 超大户群降级通知：不推全量消息体，只推轻量通知 → 刷新会话列表（置顶/摘要）
    const onNotify = () => fetchConvs();
    socket.on('new_message', onMsg);
    socket.on('new_message_batch', onMsgBatch);
    socket.on('new_message_notify', onNotify);
    socket.on('new_conversation', onNewConv);
    socket.on('conversation_messages_cleared', onCleared);
    socket.on('group_updated', onGroupUpdated);
    socket.on('group_kicked', onGroupKicked);
    socket.on('group_left', onGroupKicked); // 本账号在其他设备退群：同样移出会话列表
    socket.on('group_dismissed', onGroupDismissed);
    // 本账号在其他设备"删除聊天"：同样从列表移除
    socket.on('conversation_hidden', onGroupKicked);
    // 实时 @ 我：会话列表立即显示「[有人@我]」（原先只有刷新列表时由服务端计算，群消息多时被 @ 的人注意不到）
    const onMentioned = ({ conversationId }) => {
      if (!conversationId || conversationId === activeConvIdRef.current) return;
      setConversations(prev => prev.map(c => c.id === conversationId ? { ...c, hasMention: true } : c));
    };
    socket.on('mentioned', onMentioned);
    return () => {
      socket.off('mentioned', onMentioned);
      socket.off('new_message', onMsg);
      socket.off('new_message_batch', onMsgBatch);
      socket.off('new_message_notify', onNotify);
      socket.off('new_conversation', onNewConv);
      socket.off('conversation_messages_cleared', onCleared);
      socket.off('message_recall', onDeletedEvt);
      socket.off('message_deleted_for_me', onDeletedEvt);
      socket.off('message_deleted', onDeletedEvt);
      socket.off('message_vanished', onDeletedEvt);
      socket.off('group_updated', onGroupUpdated);
      socket.off('group_kicked', onGroupKicked);
      socket.off('group_left', onGroupKicked);
      socket.off('group_dismissed', onGroupDismissed);
      socket.off('conversation_hidden', onGroupKicked);
    };
  }, [socket, fetchConvs, user?.id]);

  // 好友/群成员改了昵称或头像（服务端 user_profile_updated）：重拉列表，备注优先级由服务端决定
  useEffect(() => {
    if (!socket) return;
    let timer;
    const onProfile = () => { clearTimeout(timer); timer = setTimeout(fetchConvs, 300); };
    socket.on('user_profile_updated', onProfile);
    return () => { clearTimeout(timer); socket.off('user_profile_updated', onProfile); };
  }, [socket, fetchConvs]);

  useEffect(() => subscribeConversationSettings(change => {
    setConversations(previous => previous.map(conversation => applyConversationSettings(conversation, change)).sort(byPinnedThenTime));
  }), []);

  // 备注变更后刷新会话列表
  useEffect(() => {
    const handler = () => fetchConvs();
    window.addEventListener('touliao:remark-changed', handler);
    return () => window.removeEventListener('touliao:remark-changed', handler);
  }, [fetchConvs]);

  const pin = useCallback(async (conv, pinned) => {
    setCtxMenu(null);
    const scope = captureSession();
    try {
      await axios.post(`/api/messages/conversation/${conv.id}/pin`, { pinned }, { _sessionContext: scope });
      publishConversationSettings(conv.id, { pinned: pinned ? 1 : 0 }, scope);
    } catch { if (isSessionCurrent(scope)) showToast(t('common.actionFailed'), 'error'); }
  }, [t]);

  const mute = async (conv, muted) => {
    setCtxMenu(null);
    const scope = captureSession();
    try {
      await axios.post(`/api/messages/conversation/${conv.id}/mute`, { muted }, { _sessionContext: scope });
      publishConversationSettings(conv.id, { muted: muted ? 1 : 0 }, scope);
    } catch { if (isSessionCurrent(scope)) showToast(t('common.actionFailed'), 'error'); }
  };

  const archive = async (conv, archived) => {
    setCtxMenu(null);
    try {
      await axios.post(`/api/messages/conversation/${conv.id}/archive`, { archived });
      setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, archived: archived ? 1 : 0 } : c));
    } catch (error) {
      showToast(error.response?.data?.error || t('chatlist.archiveFailed'), 'error');
    }
  };

  const clearArchive = async () => {
    const archived = conversations.filter(c => c.archived);
    if (!archived.length || !(await showConfirm(t('chatlist.clearArchiveConfirm')))) return;
    const results = await Promise.allSettled(archived.map(conv =>
      axios.post(`/api/messages/conversation/${conv.id}/archive`, { archived: false })
    ));
    const restored = new Set(archived.filter((_, index) => results[index].status === 'fulfilled').map(c => c.id));
    setConversations(prev => prev.map(c => restored.has(c.id) ? { ...c, archived: 0 } : c));
    if (restored.size !== archived.length) showToast(t('chatlist.clearArchivePartial'), 'error');
  };

  const deleteConv = useCallback(async (conv) => {
    setCtxMenu(null);
    if (conv.type === 'group') {
      if (!(await showConfirm(t('chatlist.confirmLeaveGroupTemplate').replace('{name}', conv.name)))) return;
      await axios.post(`/api/messages/conversation/${conv.id}/leave`).catch(() => {});
    } else {
      // 仅删除自己这一侧（原先误调双向清空接口：不确认就把对方的聊天记录也删了，且刷新后会话又回来）
      if (!(await showConfirm(t('chatlist.confirmDeleteChatTemplate').replace('{name}', conv.name)))) return;
      try {
        await axios.post(`/api/messages/conversation/${conv.id}/hide`);
      } catch {
        showToast(t('chatlist.deleteChatFailed'), 'error');
        return;
      }
      // 本地消息缓存由 SocketContext 收到 conversation_messages_cleared 时清掉
    }
    setConversations(prev => prev.filter(c => c.id !== conv.id));
  }, [t]);

  const toggleMarkUnread = async (conv) => {
    setCtxMenu(null);
    try {
      if (conv.manually_unread) {
        await axios.post(`/api/messages/conversation/${conv.id}/read`);
        setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, manually_unread: 0 } : c));
      } else {
        await axios.post(`/api/messages/conversation/${conv.id}/mark-unread`);
        setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, manually_unread: 1 } : c));
      }
    } catch { /* optimistic UI already applied; ignore mark-unread failure */ }
  };

  // Merge unread counts into conversation objects so ConvRow gets them via item reference
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const groups = splitArchivedConversations(conversations);
    return (showArchived ? groups.archived : groups.active)
      .filter(c => (c.name || '').toLowerCase().includes(q))
      .map(c => {
        const u = Object.prototype.hasOwnProperty.call(unread, c.id) ? unread[c.id] : (c.unreadCount || 0);
        return c._unread === u ? c : { ...c, _unread: u };
      })
      .filter(c => filter === 'all' || (filter === 'groups' ? c.type === 'group' : c._unread > 0 || c.manually_unread));
  }, [conversations, searchQuery, unread, showArchived, filter]);

  const archivedConversations = useMemo(() => splitArchivedConversations(conversations).archived, [conversations]);
  const archivedUnread = useMemo(() => archiveUnreadTotal(archivedConversations, unread), [archivedConversations, unread]);

  // Stable itemData - only changes when filtered or callbacks change
  const listData = useMemo(() => ({
    items: filtered,
    activeConvId,
    onSelectConv: handleSelectConv,
    onCtxMenu: setCtxMenu,
    previewMsg,
    user,
    drafts,
    onPin: pin,
    onDelete: deleteConv,
  }), [filtered, activeConvId, handleSelectConv, user, drafts, pin, deleteConv]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel)', '--tl-conversation-row-height': `${itemHeight}px`, '--windows-row-height': `${itemHeight}px` }}>
      {!searchQuery && !showArchived && (
        <div className="tl-conversation-filters" role="tablist" aria-label={t('ui.conversationFilter')}>
          {['all', 'unread', 'groups'].map(key => (
            <button type="button" key={key} role="tab" aria-selected={filter === key}
              data-testid={`conversation-filter-${key}`} onClick={() => setFilter(key)}>{t(`ui.filter.${key}`)}</button>
          ))}
        </div>
      )}
      {/* 没有归档会话时不显示入口（原网页端常驻「归档 0」占一行） */}
      {!searchQuery && !showArchived && archivedConversations.length > 0 && (
        <button type="button" className="wc-archive-entry" onClick={() => setShowArchived(true)}>
          <span className="wc-archive-icon" aria-hidden="true">▣</span>
          <span>{t('chatlist.archive')}</span>
          {archivedUnread > 0 && <span className="wc-archive-badge">{archivedUnread > 99 ? '99+' : archivedUnread}</span>}
          <span className="wc-archive-count">{archivedConversations.length}</span>
        </button>
      )}
      {showArchived && (
        <div className="wc-archive-header">
          <button type="button" onClick={() => setShowArchived(false)} aria-label={t('common.back')}><TouliaoIcon name="back" size="md" /></button>
          <strong>{t('chatlist.archivedChats')}</strong>
          <button type="button" onClick={clearArchive} disabled={archivedConversations.length === 0}>{t('chatlist.clearArchive')}</button>
        </div>
      )}
      {/* @我消息快捷入口（仅无搜索且主列表时显示） */}
      {!searchQuery && !showArchived && (
        <button
          onClick={onOpenMentions}
          data-testid="mention-list-btn"
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '13px 16px', background: 'none', border: 'none',
            borderBottom: '1px solid var(--border-subtle)',
            cursor: 'pointer', width: '100%', textAlign: 'left',
            color: 'var(--text-secondary)', fontSize: 'var(--text-sm2)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = ''; }}
        >
          <TouliaoIcon name="mention" style={{flexShrink:0}} size="sm" />
          {t('home.mentionsAriaLabel')}
        </button>
      )}
      <div className="wc-list" style={{ flex: 1 }}>
        {!loaded && conversations.length === 0 ? (
          <ChatListSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState
            illustration="chat"
            title={showArchived ? t('chatlist.archiveEmpty') : t('chatlist.empty')}
            desc={showArchived ? undefined : t('chatlist.emptyDesc')}
          />
        ) : (
          <AutoSizer>
            {({ height, width }) => (
              (!height || !width) ? null : (
                <FixedSizeList
                  height={height}
                  width={width}
                  itemCount={filtered.length}
                  itemSize={itemHeight}
                  itemData={listData}
                  overscanCount={5}
                >
                  {ConvRow}
                </FixedSizeList>
              )
            )}
          </AutoSizer>
        )}
      </div>

      {ctxMenu && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: "calc(var(--z-top) - 1)" }}
            onClick={() => setCtxMenu(null)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCtxMenu(null); } }}
            role="button"
            tabIndex={0}
            onContextMenu={e => { e.preventDefault(); setCtxMenu(null); }}
          />
          <div
            className="wc-ctx-menu"
            ref={el => {
              // 按实测尺寸收进视口（字号放大/语言不同菜单会更高更宽）
              if (!el) return;
              const r = el.getBoundingClientRect();
              if (r.right > window.innerWidth - 8) el.style.left = `${Math.max(8, window.innerWidth - r.width - 8)}px`;
              if (r.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, window.innerHeight - r.height - 8)}px`;
            }}
            style={{ left: ctxMenu.x, top: ctxMenu.y, zIndex: "var(--z-top)" }}
            role="menu"
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setCtxMenu(null); } }}
          >
            <button type="button" className="wc-ctx-item" role="menuitem" onClick={() => toggleMarkUnread(ctxMenu.conv)}>
              {ctxMenu.conv.manually_unread ? t('chatlist.markRead') : t('chatlist.markUnread')}
            </button>
            <button type="button" className="wc-ctx-item" role="menuitem" onClick={() => pin(ctxMenu.conv, !ctxMenu.conv.pinned)}>
              {ctxMenu.conv.pinned ? t('chatlist.unpinChat') : t('chatlist.pinChat')}
            </button>
            <button type="button" className="wc-ctx-item" role="menuitem" onClick={() => mute(ctxMenu.conv, !ctxMenu.conv.muted)}>
              {ctxMenu.conv.muted ? t('chatlist.unmuteChat') : t('chatlist.muteChat')}
            </button>
            <button type="button" className="wc-ctx-item" role="menuitem" onClick={() => archive(ctxMenu.conv, !ctxMenu.conv.archived)}>
              {ctxMenu.conv.archived ? t('chatlist.unarchive') : t('chatlist.archiveChat')}
            </button>
            <div className="wc-ctx-divider" />
            <button type="button" className="wc-ctx-item danger" role="menuitem" onClick={() => deleteConv(ctxMenu.conv)}>
              {ctxMenu.conv.type === 'group' ? t('chatlist.leaveGroup') : t('chatlist.deleteChat')}
            </button>
          </div>
        </>,
        document.body
      )}

    </div>
  );
}
