import React, { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import { GroupAvatar } from './GroupInfo';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { format } from '../utils/time';
import { showConfirm } from '../utils/toast';
import { FixedSizeList } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

const ITEM_HEIGHT = 64;

// Stable module-level row component so react-window doesn't unmount on re-render
const ConvRow = memo(function ConvRow({ index, style, data }) {
  const { items, activeConvId, onSelectConv, onCtxMenu, previewMsg, user } = data;
  const conv = items[index];
  const count = conv._unread || 0;
  return (
    <div style={style}>
      <div
        className={`wc-chat-item${conv.id === activeConvId ? ' active' : ''}${conv.pinned ? ' pinned' : ''}`}
        onClick={() => onSelectConv(conv)}
        onKeyDown={e => e.key === 'Enter' && onSelectConv(conv)}
        role="button"
        tabIndex={0}
        onContextMenu={e => { e.preventDefault(); onCtxMenu({ x: e.clientX, y: e.clientY, conv }); }}
        style={{ background: conv.pinned && conv.id !== activeConvId ? '#F9F9F9' : undefined }}
      >
        <div className="wc-chat-item-avatar">
          {conv.type === 'group'
            ? <GroupAvatar members={conv.members || []} avatar={conv.avatar} size={46} />
            : <Avatar src={conv.avatar} name={conv.name} size={46} />
          }
          {count > 0 && <span className={`wc-chat-item-badge${conv.muted ? ' muted' : ''}`}>{count > 99 ? '99+' : count}</span>}
        </div>
        <div className="wc-chat-item-info">
          <div className="wc-chat-item-row1">
            <span className="wc-chat-item-name">{conv.name || '未知'}</span>
            <span className="wc-chat-item-time">{conv.lastTime ? format(conv.lastTime * 1000) : ''}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            {!!conv.muted && (
              <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, fill: 'var(--text-tertiary)', flexShrink: 0 }}>
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
              </svg>
            )}
            <span className="wc-chat-item-preview">{previewMsg(conv, user)}</span>
          </div>
        </div>
        {conv.pinned && (
          <svg viewBox="0 0 24 24" style={{ position: 'absolute', top: 7, right: 8, width: 10, height: 10, fill: 'var(--text-tertiary)' }}>
            <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/>
          </svg>
        )}
      </div>
    </div>
  );
}, (prev, next) => {
  const pi = prev.data.items[prev.index];
  const ni = next.data.items[next.index];
  return pi === ni && prev.data.activeConvId === next.data.activeConvId && prev.style.top === next.style.top;
});

function previewMsg(conv, user) {
  const t = conv.lastMessageType;
  if (t === 'image') return '[图片]';
  if (t === 'voice') return '[语音]';
  if (t === 'video') return '[视频]';
  if (t === 'file') return '[文件]';
  if (t === 'contact_card' || t === 'contact') return '[名片]';
  if (t === 'red_packet') return '[红包]';
  if (t === 'sticker') return '[表情]';
  if (!conv.lastMessage) return '';
  if (conv.type === 'group' && conv.lastSenderName && conv.lastSenderName !== user?.username)
    return `${conv.lastSenderName}: ${conv.lastMessage}`;
  return conv.lastMessage;
}

export default function ChatList({ onSelectConv, activeConvId, unread = {}, searchQuery = '', convRefreshKey = 0 }) {
  const [conversations, setConversations] = useState([]);
  const [ctxMenu, setCtxMenu] = useState(null);
  const { socket, reconnectCount } = useSocket();
  const { user } = useAuth();

  const fetchConvs = useCallback(async () => {
    const { data } = await axios.get('/api/messages/conversations');
    setConversations(data);
  }, []);

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
        updated[idx] = { ...updated[idx], lastMessage: msg.content, lastMessageType: msg.type, lastTime: msg.created_at, lastSenderName: msg.senderName };
        return [...updated].sort((a, b) => (b.pinned - a.pinned) || ((b.lastTime || 0) - (a.lastTime || 0)));
      });
    };
    const onNewConv = (conv) => {
      setConversations(prev => {
        if (prev.find(c => c.id === conv.id)) return prev;
        socket.emit('join_conversation', { conversationId: conv.id });
        return [conv, ...prev];
      });
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
    // 群更新（群名/头像/公告等变化时刷新）
    const onGroupUpdated = () => fetchConvs();
    // 被踢出群 / 群解散：从列表中立即移除该会话
    const onGroupKicked    = ({ conversationId }) =>
      setConversations(prev => prev.filter(c => c.id !== conversationId));
    const onGroupDismissed = ({ conversationId }) =>
      setConversations(prev => prev.filter(c => c.id !== conversationId));

    const onMsgBatch = (arr) => { if (Array.isArray(arr)) for (const m of arr) onMsg(m); };
    socket.on('new_message', onMsg);
    socket.on('new_message_batch', onMsgBatch);
    socket.on('new_conversation', onNewConv);
    socket.on('conversation_messages_cleared', onCleared);
    socket.on('group_updated', onGroupUpdated);
    socket.on('group_kicked', onGroupKicked);
    socket.on('group_dismissed', onGroupDismissed);
    return () => {
      socket.off('new_message', onMsg);
      socket.off('new_message_batch', onMsgBatch);
      socket.off('new_conversation', onNewConv);
      socket.off('conversation_messages_cleared', onCleared);
      socket.off('group_updated', onGroupUpdated);
      socket.off('group_kicked', onGroupKicked);
      socket.off('group_dismissed', onGroupDismissed);
    };
  }, [socket, fetchConvs]);

  // 备注变更后刷新会话列表
  useEffect(() => {
    const handler = () => fetchConvs();
    window.addEventListener('vxin:remark-changed', handler);
    return () => window.removeEventListener('vxin:remark-changed', handler);
  }, [fetchConvs]);

  const pin = async (conv, pinned) => {
    await axios.post(`/api/messages/conversation/${conv.id}/pin`, { pinned });
    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, pinned: pinned ? 1 : 0 } : c)
      .sort((a, b) => (b.pinned - a.pinned) || ((b.lastTime || 0) - (a.lastTime || 0))));
    setCtxMenu(null);
  };

  const mute = async (conv, muted) => {
    await axios.post(`/api/messages/conversation/${conv.id}/mute`, { muted });
    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, muted: muted ? 1 : 0 } : c));
    setCtxMenu(null);
  };

  const deleteConv = async (conv) => {
    setCtxMenu(null);
    if (conv.type === 'group') {
      if (!(await showConfirm(`确认退出群聊「${conv.name}」？`))) return;
      await axios.post(`/api/messages/conversation/${conv.id}/leave`).catch(() => {});
    } else {
      await axios.delete(`/api/messages/conversation/${conv.id}/messages`).catch(() => {});
    }
    setConversations(prev => prev.filter(c => c.id !== conv.id));
  };

  // Merge unread counts into conversation objects so ConvRow gets them via item reference
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return conversations
      .filter(c => (c.name || '').toLowerCase().includes(q))
      .map(c => {
        const u = unread[c.id] || 0;
        return c._unread === u ? c : { ...c, _unread: u };
      });
  }, [conversations, searchQuery, unread]);

  // Stable itemData - only changes when filtered or callbacks change
  const listData = useMemo(() => ({
    items: filtered,
    activeConvId,
    onSelectConv,
    onCtxMenu: setCtxMenu,
    previewMsg,
    user,
  }), [filtered, activeConvId, onSelectConv, user]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel)' }}>
      <div className="wc-list" style={{ flex: 1 }}>
        {filtered.length === 0 ? (
          <div role="status" style={{ textAlign: 'center', padding: '40px 0', color: '#B2B2B2', fontSize: 13 }}>暂无聊天</div>
        ) : (
          <AutoSizer>
            {({ height, width }) => (
              (!height || !width) ? null : (
                <FixedSizeList
                  height={height}
                  width={width}
                  itemCount={filtered.length}
                  itemSize={ITEM_HEIGHT}
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

      {ctxMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setCtxMenu(null)} />
          <div className="wc-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999 }}>
            <div className="wc-ctx-item" onClick={() => pin(ctxMenu.conv, !ctxMenu.conv.pinned)}
              role="button" tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && pin(ctxMenu.conv, !ctxMenu.conv.pinned)}>
              {ctxMenu.conv.pinned ? '取消置顶' : '置顶聊天'}
            </div>
            <div className="wc-ctx-item" onClick={() => mute(ctxMenu.conv, !ctxMenu.conv.muted)}
              role="button" tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && mute(ctxMenu.conv, !ctxMenu.conv.muted)}>
              {ctxMenu.conv.muted ? '取消免打扰' : '消息免打扰'}
            </div>
            <div className="wc-ctx-divider" />
            <div className="wc-ctx-item danger" onClick={() => deleteConv(ctxMenu.conv)}
              role="button" tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && deleteConv(ctxMenu.conv)}>
              {ctxMenu.conv.type === 'group' ? '退出群聊' : '删除聊天'}
            </div>
          </div>
        </>
      )}

    </div>
  );
}
