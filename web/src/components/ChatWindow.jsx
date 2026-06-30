import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { showToast, showConfirm } from '../utils/toast';
import axios from 'axios';
import Avatar from './Avatar';
import ImagePreview from './ImagePreview';
import VirtualMessageList from './VirtualMessageList';

// ── 模块级常量，避免每次渲染重建 Set ────────────────────────────
const ALLOWED_MIME_SET = new Set([
  'image/jpeg','image/png','image/gif','image/webp',
  'audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav',
  'video/mp4','video/quicktime','video/webm',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip','application/x-zip-compressed',
  'application/x-rar-compressed','application/x-7z-compressed',
  'text/plain',
]);
const BLOCKED_EXTENSIONS = new Set([
  '.exe','.bat','.cmd','.sh','.ps1','.vbs','.js','.jar',
  '.msi','.dll','.com','.scr','.pif','.hta','.cpl',
]);
import EmojiPicker from './EmojiPicker';
import StickerPanel from './StickerPanel';
import GroupInfo, { GroupAvatar } from './GroupInfo';
import UserProfile from './UserProfile';
import RedPacketModal from './RedPacketModal';
import ForwardModal from './ForwardModal';
import GroupCallModal from './GroupCallModal';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { format, formatFull } from '../utils/time';
import { mediaUrl } from '../utils/url';
import './ChatWindow.css';

const REACTIONS = ['👍','❤️','😄','😮','😢','🙏'];

// ── 粉碎动画（删除不留痕迹）────────────────────────────────────
// 找到消息气泡，用 N 条色块覆盖后交替旋转下落，结束后调 onDone
function playShredAnimation(msgId, onDone) {
  const msgRow = document.getElementById(`msg-${msgId}`);
  const bubble = msgRow?.querySelector(`[data-testid="msg-bubble-${msgId}"]`);
  if (!bubble) { onDone?.(); return; }

  const rect = bubble.getBoundingClientRect();
  const isMine = bubble.classList.contains('mine');
  const N = 9;
  const stripW = rect.width / N;

  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    position: 'fixed', top: `${rect.top}px`, left: `${rect.left}px`,
    width: `${rect.width}px`, height: `${rect.height}px`,
    zIndex: '9999', pointerEvents: 'none',
    display: 'flex', overflow: 'visible',
  });

  for (let i = 0; i < N; i++) {
    const strip = document.createElement('div');
    const isOdd = i % 2 === 0;
    Object.assign(strip.style, {
      width: `${stripW + 0.5}px`,   // +0.5 防止间隙
      flexShrink: '0',
      height: `${rect.height}px`,
      background: getComputedStyle(bubble).backgroundColor || (isMine ? '#95EC69' : '#ffffff'),
      borderRadius: i === 0 ? '12px 0 0 12px' : i === N - 1 ? '0 12px 12px 0' : '0',
      boxShadow: isMine ? 'none' : '0 0 0 0.5px rgba(0,0,0,0.08)',
      animation: `shred-${isOdd ? 'odd' : 'even'} 0.46s ${i * 28}ms ease-in both`,
    });
    wrap.appendChild(strip);
  }

  bubble.style.visibility = 'hidden';
  document.body.appendChild(wrap);

  // 最后一条 strip: 8*28=224ms + 460ms = ~684ms
  const totalMs = (N - 1) * 28 + 480;
  setTimeout(() => { wrap.remove(); onDone?.(); }, totalMs);
}

export default function ChatWindow({ conversation: initialConv, onClose, onStartCall }) {
  const [conversation, setConversation] = useState(initialConv);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [typingName, setTypingName] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [members, setMembers] = useState([]);
  const [myGroupRole, setMyGroupRole] = useState('member'); // 'owner'|'admin'|'member'
  const [groupSettings, setGroupSettings] = useState({ mute_all: 0, no_private_chat: 0, no_add_friend: 0 });
  const [showUserProfile, setShowUserProfile] = useState(null);
  const [showCardPicker, setShowCardPicker] = useState(false);  // 分享名片：联系人选择器
  const [cardContacts, setCardContacts] = useState([]);
  const [editingMsg, setEditingMsg] = useState(null);
  const [forwardMsg, setForwardMsg] = useState(null);
  const [showRedPacket, setShowRedPacket] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [vanishingMsgs, setVanishingMsgs] = useState(new Set());
  // 多选模式
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedMsgs, setSelectedMsgs] = useState(new Set());
  // 置顶消息
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [showPinnedDetail, setShowPinnedDetail] = useState(false);
  const [atList, setAtList] = useState(null); // members for @ mention
  const [atIndex, setAtIndex] = useState(0); // selected index in atList
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // 通话状态
  const [groupCall, setGroupCall] = useState(null);        // 进行中的群通话 session
  const [groupCallInvite, setGroupCallInvite] = useState(null); // 收到的群通话邀请
  // 文件上传进度：null | { name, progress:0-100, status:'uploading'|'error', retryFn? }
  const [uploadState, setUploadState] = useState(null);
  // 搜索消息
  const [showMsgSearch, setShowMsgSearch] = useState(false);
  const [msgSearchQ, setMsgSearchQ] = useState('');
  const [highlightedMsgId, setHighlightedMsgId] = useState(null);
  const [pendingScrollId, setPendingScrollId] = useState(null);
  const [msgSearchResults, setMsgSearchResults] = useState([]);
  const [msgSearching, setMsgSearching] = useState(false);
  // 红包：详情弹窗 { packet, claims, myClaim, justClaimed } | null
  const [redPacketDetail, setRedPacketDetail] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [lightboxState, setLightboxState] = useState(null); // { urls, idx } or null
  const [isDragOver, setIsDragOver] = useState(false);
  // recalled content tracked in state so flatItems rebuilds when re-edit is clicked
  const [recalledMessages, setRecalledMessages] = useState({});
  const dragCounterRef = useRef(0);
  const isUploadingRef    = useRef(false); // 防止并发上传
  const lastSendRef       = useRef({ text: '', time: 0 }); // 防止 Enter 连击重复发送
  const pendingMsgsRef    = useRef(new Map()); // tempId → timeoutHandle
  const confirmedMsgIds   = useRef(new Set()); // ack 已确认的真实 msg.id，onMsg 跳过
  const readerReadAtRef   = useRef({}); // uid → last known readAt (prevents duplicate readCount increments)
  const claimingRef       = useRef(false); // mirror of claiming for stable callbacks
  // Virtual list refs (replace messagesContainerRef + messagesEndRef)
  const virtListRef  = useRef(null); // VirtualMessageList imperative handle
  const listOuterRef = useRef(null); // actual scrollable DOM div from react-window
  const forceScrollRef = useRef(false); // 置位→下次 messages 变化无条件贴底(自己发消息时用)
  // Item cache for flatItems - preserve object identity for unchanged messages
  const itemCacheRef = useRef(new Map());
  const fileInputRef = useRef(null);
  const audioRef = useRef(null); // 当前播放中的语音，防止并发播放
  const typingTimer = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const textareaRef = useRef(null);
  const inputAreaRef = useRef(null);
  const { socket, reconnectCount, disconnectAtRef, registerDelivered } = useSocket();
  const { user } = useAuth();

  // ── 点击输入区外部关闭 emoji / more / 表情包 面板 ────────────────────
  useEffect(() => {
    if (!showEmoji && !showMore && !showStickers) return;
    const handler = (e) => {
      if (inputAreaRef.current && !inputAreaRef.current.contains(e.target)) {
        setShowEmoji(false);
        setShowMore(false);
        setShowStickers(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmoji, showMore, showStickers]);

  // ── 手机软键盘弹起：viewport 缩小时滚动置底 ─────────────────
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const outer = listOuterRef.current;
      if (!outer) return;
      if (outer.scrollHeight - outer.scrollTop - outer.clientHeight < 200)
        outer.scrollTo({ top: outer.scrollHeight, behavior: 'instant' });
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  // 搜索消息（AbortController 防止快速输入时旧结果覆盖新结果）
  const searchAbortRef = useRef(null);
  const searchMessages = useCallback(async (q) => {
    searchAbortRef.current?.abort();           // 取消上一次未完成的搜索
    if (!q.trim()) { setMsgSearchResults([]); return; }
    const ac = new AbortController();
    searchAbortRef.current = ac;
    setMsgSearching(true);
    try {
      const { data } = await axios.get(
        `/api/messages/conversation/${conversation.id}/search`,
        { params: { q }, signal: ac.signal }
      );
      if (!ac.signal.aborted) setMsgSearchResults(data);
    } catch (err) {
      if (!axios.isCancel?.(err) && err.code !== 'ERR_CANCELED') setMsgSearchResults([]);
    }
    if (!ac.signal.aborted) setMsgSearching(false);
  }, [conversation.id]);

  // 发起通话（状态提升到 Home，通知父组件）
  const startCall = useCallback((type) => {
    if (conversation.type !== 'private') return;
    const remoteUser = { id: conversation.otherUser?.id, name: conversation.name, avatar: conversation.avatar };
    socket?.emit('call:request', {
      to: conversation.otherUser?.id,
      type,
      caller: { id: user.id, name: user.username, avatar: user.avatar },
    });
    onStartCall?.({ type, direction: 'outgoing', remoteUser, remoteId: conversation.otherUser?.id });
  }, [socket, conversation, user, onStartCall]);

  // 发起群通话（群聊）
  const startGroupCall = useCallback((type) => {
    if (conversation.type !== 'group' || groupCall) return;
    setGroupCallInvite(null);
    setGroupCall({ mode: 'start', conversationId: conversation.id, type });
  }, [conversation.type, conversation.id, groupCall]);

  // 监听本群的群通话邀请（仅当前打开的群，避免与 1:1 来电逻辑冲突）
  useEffect(() => {
    if (!socket) return;
    const onInvite = (inv) => {
      if (inv.conversationId !== conversation.id) return;     // 只提示当前群
      if (groupCall) return;                                  // 已在通话中
      setGroupCallInvite(inv);
    };
    socket.on('group_call:invite', onInvite);
    return () => socket.off('group_call:invite', onInvite);
  }, [socket, conversation.id, groupCall]);

  const joinGroupCall = useCallback(() => {
    if (!groupCallInvite) return;
    setGroupCall({ mode: 'join', callId: groupCallInvite.callId, conversationId: groupCallInvite.conversationId, type: groupCallInvite.type });
    setGroupCallInvite(null);
  }, [groupCallInvite]);

  // 阅后即焚：Map msgId → setTimeout handle，切换会话时统一取消
  const burnTimersRef = useRef(new Map());
  const scheduleBurn = React.useCallback((msgs) => {
    const ba = conversation.burn_after || 0;
    if (!ba || !msgs.length) return;
    const now = Date.now() / 1000;
    msgs.forEach(msg => {
      if (!msg?.id || burnTimersRef.current.has(msg.id)) return;
      const remaining = Math.max(0, ba - (now - msg.created_at)) * 1000;
      const handle = setTimeout(() => {
        axios.delete(`/api/messages/${msg.id}`, { data: { vanish: true } }).catch(() => {});
        setMessages(prev => prev.filter(m => m.id !== msg.id));
        burnTimersRef.current.delete(msg.id);
      }, remaining);
      burnTimersRef.current.set(msg.id, handle);
    });
  }, [conversation.burn_after]);

  // 组件卸载（关闭会话/切换会话）时标记已读
  const convIdRef   = useRef(conversation.id);
  const convTypeRef = useRef(conversation.type);
  const messagesRef = useRef([]);
  const membersRef  = useRef([]);
  useEffect(() => { convIdRef.current   = conversation.id;   }, [conversation.id]);
  useEffect(() => { convTypeRef.current = conversation.type; }, [conversation.type]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { membersRef.current  = members;  }, [members]);
  useEffect(() => {
    return () => {
      if (recorderRef.current) stopRecording();
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      clearTimeout(typingTimer.current);
      // 切换会话时取消所有阅后即焚定时器，防止旧会话定时器影响新会话消息状态
      burnTimersRef.current.forEach(handle => clearTimeout(handle));
      burnTimersRef.current.clear();
    };
  }, [conversation.id]);
  useEffect(() => {
    const sendRead = () => {
      try {
        const lastMsg = messagesRef.current[messagesRef.current.length - 1];
        if (!lastMsg) return;
        const path = `/api/messages/conversation/${convIdRef.current}/read`;
        const body = JSON.stringify({ messageId: lastMsg.id });
        // 使用完整 URL（Electron file:// 下相对路径会解析到 file:/// 导致失败）
        const base = (axios.defaults.baseURL || '').replace(/\/+$/, '');
        const fullUrl = base ? `${base}${path}` : path;
        // sendBeacon 无法携带自定义 header（CSRF token），统一改用 fetch keepalive
        // keepalive=true 与 sendBeacon 同样可在页面卸载时可靠投递
        const csrfToken = document.cookie.split(';').map(c => c.trim())
          .find(c => c.startsWith('csrf_token='))?.slice('csrf_token='.length);
        fetch(fullUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
          body,
          keepalive: true,
        }).catch(() => {});
      } catch { /* 清理函数中的异常静默忽略，不影响 React 卸载流程 */ }
    };
    window.addEventListener('beforeunload', sendRead);
    return () => {
      window.removeEventListener('beforeunload', sendRead);
      sendRead(); // 切换会话时触发
    };
  }, [conversation.id]);

  const fetchMessages = useCallback(async (before = null, signal = null) => {
    const params = { limit: 40 };
    if (before) params.before = before;
    const { data } = await axios.get(`/api/messages/${conversation.id}`, { params, signal });
    return data;
  }, [conversation.id]);

  // Sync conversation prop changes
  useEffect(() => {
    // 处理虚拟 filehelper ID：获取真实会话
    if (initialConv?.id === '__file-helper__') {
      axios.get('/api/messages/file-helper').then(({ data }) => {
        setConversation({ ...initialConv, id: data.conversationId });
      }).catch(() => {
        setConversation(initialConv);
      });
    } else {
      setConversation(initialConv);
    }
  }, [initialConv]);

  // 断线重连后补拉当前会话缺失消息
  useEffect(() => {
    if (reconnectCount === 0) return; // 首次连接不触发
    const after = disconnectAtRef.current;
    if (!after) return;
    // after-1: 覆盖同秒边界 — DB created_at 是秒精度，断线和消息落库可能同秒，
    // 用 > after 会漏掉。-1s 扩大窗口，重复消息由下方 existingIds 去重。
    axios.get(`/api/messages/${conversation.id}`, { params: { after: after - 1, limit: 100 } })
      .then(({ data }) => {
        if (!data.length) return;
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const newMsgs = data.filter(m => !existingIds.has(m.id));
          if (!newMsgs.length) return prev;
          setTimeout(() => {
            const outer = listOuterRef.current;
            if (outer) outer.scrollTo({ top: outer.scrollHeight, behavior: 'smooth' });
          }, 50);
          return [...prev, ...newMsgs];
        });
      })
      .catch(() => {});
  }, [reconnectCount, conversation.id]);

  useEffect(() => {
    setMessages([]);
    setReplyTo(null);
    setEditingMsg(null); // 清编辑态:否则在A会话编辑中切到B会话,发送会PUT改A的消息(跨会话误编辑)
    setShowEmoji(false);
    setShowMore(false);
    setVoiceMode(false);
    setHasMore(true);
    setShowGroupInfo(false);
    setMultiSelect(false);
    setSelectedMsgs(new Set());
    setPinnedMessages([]);
    // 草稿自动加载
    const savedDraft = localStorage.getItem(`draft_${conversation.id}`);
    setInput(savedDraft || '');

    // AbortController：会话切换时取消上一个会话的未完成请求，防止数据串堂
    const ac = new AbortController();
    // 加载置顶消息
    axios.get(`/api/messages/conversation/${conversation.id}/pinned-messages`, { signal: ac.signal })
      .then(r => { if (!ac.signal.aborted) setPinnedMessages(r.data); })
      .catch(() => {});

    fetchMessages(null, ac.signal)
      .then(data => {
        if (ac.signal.aborted) return; // 会话已切走，丢弃结果
        setMessages(data);
        scheduleBurn(data);
        setHasMore(data.length === 40);
        // 搜索结果跳转：如果有 scrollToId，则滚到该消息；否则滚到底部
        setTimeout(() => {
          const outer = listOuterRef.current;
          if (!outer) return;
          const scrollToId = conversation.scrollToId;
          if (scrollToId) {
            const targetEl = document.getElementById(`msg-${scrollToId}`);
            if (targetEl) {
              targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
              return;
            }
          }
          outer.scrollTo({ top: outer.scrollHeight, behavior: 'auto' });
        }, 50);
      })
      .catch(err => { if (axios.isCancel?.(err) || err.code === 'ERR_CANCELED') return; });

    socket?.emit('join_conversation', { conversationId: conversation.id });

    if (conversation.type === 'group') {
      // 获取群详情：成员列表、我的角色、管理设置
      axios.get(`/api/messages/conversation/${conversation.id}/info`, { signal: ac.signal }).then(r => {
        if (ac.signal.aborted) return;
        setMembers(r.data.members || []);
        setMyGroupRole(r.data.myRole || 'member');
        setGroupSettings({ mute_all: r.data.mute_all || 0, no_private_chat: r.data.no_private_chat || 0, no_add_friend: r.data.no_add_friend || 0 });
      }).catch(() => {});
    }

    // 打开会话时标记已读（不带 messageId，后端自动取最新消息）
    axios.post(`/api/messages/conversation/${conversation.id}/read`, {}, { signal: ac.signal }).catch(() => {});

    return () => {
      ac.abort(); // 切换会话时取消未完成拉取
      // 清理所有待确认的发送 timer，避免旧会话 timer 污染新会话 UI
      pendingMsgsRef.current.forEach(timer => clearTimeout(timer));
      pendingMsgsRef.current.clear();
      confirmedMsgIds.current.clear();
      readerReadAtRef.current = {};
    };
  }, [conversation.id, fetchMessages, socket, conversation.type]);

  // 新消息到达且当前在底部时，自动标记已读（带最新消息 ID）
  const markReadRef = useRef(null);
  useEffect(() => {
    if (!messages.length) return;
    const outer = listOuterRef.current;
    const isAtBottom = !outer || (outer.scrollHeight - outer.scrollTop - outer.clientHeight < 120);
    if (!isAtBottom) return;
    const lastMsg = messages[messages.length - 1];
    if (markReadRef.current === lastMsg.id) return;
    markReadRef.current = lastMsg.id;
    axios.post(`/api/messages/conversation/${conversation.id}/read`, { messageId: lastMsg.id }).catch(() => {});
  }, [messages, conversation.id]);

  // 备注变更后刷新聊天窗口头部（昵称/备注）
  useEffect(() => {
    const handler = () => {
      // 只对私聊刷新对方信息
      if (conversation.type !== 'private' || !conversation.otherUser?.id) return;
      axios.get(`/api/users/${conversation.otherUser.id}`).then(({ data }) => {
        setConversation(prev => ({
          ...prev,
          name: data.remark || data.username || prev.name,
          otherUser: { ...prev.otherUser, ...data }
        }));
      }).catch(() => {});
    };
    window.addEventListener('vxin:remark-changed', handler);
    return () => window.removeEventListener('vxin:remark-changed', handler);
  }, [conversation.type, conversation.otherUser?.id]);

  // 发送/收到消息时自动跟随到底部。
  // 新消息行高由 ResizeObserver 异步测得，单次 scrollTo 会因高度未定而滚不到底，
  // 故用多帧 sticky 滚动持续贴底，直到高度测量稳定。
  // forceScrollRef：自己发消息时置位 → 无条件贴底（即使之前在翻历史），
  //   修复"在上方查看历史时发消息看不到自己刚发的消息"。收到他人消息仍只在接近底部时跟随。
  useEffect(() => {
    const outer = listOuterRef.current;
    if (!outer) return;
    const force = forceScrollRef.current;
    forceScrollRef.current = false;
    const isAtBottom = outer.scrollHeight - outer.scrollTop - outer.clientHeight < 400;
    if (!force && !isAtBottom) return;
    let n = 0, raf = 0;
    const step = () => {
      const o = listOuterRef.current;
      if (!o) return;
      o.scrollTop = o.scrollHeight;
      if (++n < 12) raf = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, [messages]);

  // Load more on scroll to top — RAF 节流，避免高频 scroll 事件触发多次 setState
  const scrollRafRef = useRef(null);
  const handleScrollRef = useRef(null);
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(async () => {
      scrollRafRef.current = null;
      const container = listOuterRef.current;
      if (!container) return;
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      setShowScrollBtn(distFromBottom > 300);
      if (loadingMore || !hasMore) return;
      if (container.scrollTop < 60 && messages.length > 0) {
        setLoadingMore(true);
        const oldest     = messages[0]?.created_at;
        const snapConvId = convIdRef.current;
        try {
          const data = await fetchMessages(oldest);
          if (convIdRef.current !== snapConvId) return;
          if (!data || data.length === 0) {
            setHasMore(false);
          } else {
            // 锚定滚动位置：prepend 历史消息后保持当前视口位置不跳动
            const prevHeight = container.scrollHeight;
            setMessages(prev => [...data, ...prev]);
            requestAnimationFrame(() => {
              if (listOuterRef.current)
                listOuterRef.current.scrollTop += listOuterRef.current.scrollHeight - prevHeight;
            });
          }
        } catch (err) {
          // Failed to load more messages — suppressed
        } finally {
          setLoadingMore(false);
        }
      }
    });
  }, [loadingMore, hasMore, messages, fetchMessages]);
  handleScrollRef.current = handleScroll;

  // Attach scroll listener to react-window outer div once after mount
  useEffect(() => {
    const outer = listOuterRef.current;
    if (!outer) return;
    const stableHandler = () => handleScrollRef.current?.();
    outer.addEventListener('scroll', stableHandler, { passive: true });
    return () => outer.removeEventListener('scroll', stableHandler);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onMsg = (msg) => {
      const currentConvId = convIdRef.current;
      if (msg.conversation_id !== currentConvId) return;
      if (confirmedMsgIds.current.has(msg.id)) {
        confirmedMsgIds.current.delete(msg.id);
        return;
      }
      window.__vxinPerf?.recv(msg, user.id, 'socket');
      // 自己发的消息(如文件/图片经后端广播回来)：无条件贴底，与文本发送一致
      if (msg.sender_id === user.id) forceScrollRef.current = true;
      setMessages(prev => {
        if (prev.find(m => m.id === msg.id)) return prev;
        // 用 client_msg_id 匹配并替换本地乐观消息(tempId),否则 socket 重连自动重发后
        // 广播回来的真实消息(新id) 会与乐观消息并存 → 重复显示。
        if (msg.client_msg_id) {
          const idx = prev.findIndex(m => (m._tempId === msg.client_msg_id || m.id === msg.client_msg_id));
          if (idx >= 0) {
            const next = prev.slice();
            next[idx] = msg;
            return next;
          }
        }
        return [...prev, msg];
      });
      scheduleBurn([msg]);
      // 不在此无条件上报已读:已读由 markReadRef effect 在 messages 变化后处理,
      // 且仅当滚动在底部时才标(line ~375)。此前无条件上报会让"翻历史时收到的消息"
      // 也被标已读→污染对方已读回执 + 每条消息一个 POST 的请求风暴。
    };
    // 批量合并消息：一次性 append + 单次滚动（已读由 markReadRef effect 统一处理）
    const onMsgBatch = (arr) => {
      if (!Array.isArray(arr) || !arr.length) return;
      const cur = convIdRef.current;
      const incoming = [];
      for (const msg of arr) {
        if (msg.conversation_id !== cur) continue;
        if (confirmedMsgIds.current.has(msg.id)) { confirmedMsgIds.current.delete(msg.id); continue; }
        incoming.push(msg);
      }
      if (!incoming.length) return;
      setMessages(prev => {
        const have = new Set(prev.map(m => m.id));
        let next = prev.slice();
        let changed = false;
        for (const msg of incoming) {
          if (have.has(msg.id)) continue;
          // 同 onMsg:用 client_msg_id 替换乐观消息,防重连重发双显
          if (msg.client_msg_id) {
            const idx = next.findIndex(m => (m._tempId === msg.client_msg_id || m.id === msg.client_msg_id));
            if (idx >= 0) { next[idx] = msg; changed = true; continue; }
          }
          next.push(msg); changed = true;
        }
        return changed ? next : prev;
      });
      // 仅在底部附近或自己发的消息才跟随，与 onMsg 逻辑保持一致
      const hasMine = incoming.some(m => m.sender_id === user.id);
      if (hasMine) forceScrollRef.current = true;
      else {
        const outer = listOuterRef.current;
        const isAtBottom = outer && (outer.scrollHeight - outer.scrollTop - outer.clientHeight < 400);
        if (!isAtBottom) return;
      }
      setTimeout(() => {
        const outer = listOuterRef.current;
        if (outer) outer.scrollTo({ top: outer.scrollHeight, behavior: 'smooth' });
      }, 50);
    };
    const onTyping = ({ userId, conversationId }) => {
      if (conversationId !== convIdRef.current || userId === user.id) return;
      const name = membersRef.current.find(m => m.id === userId)?.username
        || messagesRef.current.find(m => m.sender_id === userId)?.senderName
        || '对方';
      setTypingName(name);
    };
    const onStopTyping = ({ conversationId }) => {
      if (conversationId === convIdRef.current) setTypingName('');
    };
    const onDeleted = ({ msgId }) => {
      setMessages(prev => {
        const target = prev.find(m => m.id === msgId);
        if (target && target.sender_id === user.id && target.type === 'text' && !target.deleted) {
          setRecalledMessages(r => ({ ...r, [msgId]: target.content }));
        }
        return prev.map(m => m.id === msgId ? { ...m, deleted: 1, content: '消息已撤回' } : m);
      });
    };
    const onVanished = ({ msgId }) => {
      playShredAnimation(msgId, () => {
        setMessages(prev => prev.filter(m => m.id !== msgId));
        setVanishingMsgs(prev => { const s = new Set(prev); s.delete(msgId); return s; });
      });
    };
    const onBatchDeleted = ({ msgIds: ids }) => {
      if (!ids?.length) return;
      const idSet = new Set(ids);
      setMessages(prev => prev.map(m => idSet.has(m.id) ? { ...m, deleted: 1, content: '消息已撤回' } : m));
    };
    const onCleared = ({ conversationId }) => {
      if (conversationId !== convIdRef.current) return;
      setMessages([]);
      setPinnedMessages([]);
    };
    const onEdited = ({ msgId, content }) => {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, content, edited: 1 } : m));
    };
    const onReaction = ({ msgId, reactions }) => {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reactions } : m));
    };
    const onRead = ({ userId: uid, conversationId, readAt }) => {
      if (conversationId !== convIdRef.current || uid === user.id) return;
      if (convTypeRef.current === 'private') {
        setMessages(prev => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].sender_id === user.id) { copy[i] = { ...copy[i], _read: true }; break; }
          }
          return copy;
        });
      } else {
        const prevReadAt = readerReadAtRef.current[uid] || 0;
        if (readAt <= prevReadAt) return; // same or older read position — nothing new
        readerReadAtRef.current[uid] = readAt;
        setMessages(prev => prev.map(m =>
          m.sender_id === user.id && m.created_at > prevReadAt && m.created_at <= readAt
            ? { ...m, readCount: (m.readCount || 0) + 1 }
            : m
        ));
      }
    };
    const onGroupUpdated = ({ id, name, avatar, announcement }) => {
      if (id !== convIdRef.current) return;
      setConversation(prev => ({
        ...prev,
        ...(name ? { name } : {}),
        ...(avatar !== undefined ? { avatar } : {}),
        ...(announcement !== undefined ? { announcement } : {}),
      }));
      axios.get(`/api/messages/conversation/${convIdRef.current}/info`).then(r => {
        setMembers(r.data.members || []);
        setMyGroupRole(r.data.myRole || 'member');
        setGroupSettings({ mute_all: r.data.mute_all || 0, no_private_chat: r.data.no_private_chat || 0, no_add_friend: r.data.no_add_friend || 0 });
      }).catch(() => {});
    };
    const onPinned = (data) => {
      if (data.convId !== convIdRef.current) return;
      setPinnedMessages(prev => {
        if (prev.find(p => p.msgId === data.msgId)) return prev;
        return [{ msgId: data.msgId, content: data.content, type: data.type, pinnedByName: data.pinnedBy }, ...prev];
      });
    };
    const onUnpinned = ({ msgId, convId }) => {
      if (convId !== convIdRef.current) return;
      setPinnedMessages(prev => prev.filter(p => p.msgId !== msgId));
    };
    const onGroupSettingsUpdated = (data) => {
      if (data.id !== convIdRef.current) return;
      setGroupSettings(prev => ({ ...prev, mute_all: data.mute_all ?? prev.mute_all, no_private_chat: data.no_private_chat ?? prev.no_private_chat, no_add_friend: data.no_add_friend ?? prev.no_add_friend }));
    };
    const onGroupKicked = ({ conversationId }) => {
      if (conversationId === convIdRef.current) onClose?.();
    };
    const onGroupDismissed = ({ conversationId }) => {
      if (conversationId === convIdRef.current) { showToast('群聊已解散'); onClose?.(); }
    };
    // 送达回执：发送方收到，标记私聊消息为"已送达"
    const onDelivered = ({ messageId, messages: items }) => {
      if (convTypeRef.current !== 'private') return;
      if (messageId) {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, _delivered: true } : m));
      } else if (items?.length) {
        const idSet = new Set(items.filter(i => i.conversationId === convIdRef.current).map(i => i.messageId));
        if (idSet.size > 0) {
          setMessages(prev => prev.map(m => idSet.has(m.id) ? { ...m, _delivered: true } : m));
        }
      }
    };

    // @mention 通知
    const onAtMention = ({ fromUserName, groupName, messagePreview }) => {
      if (!('Notification' in window) || Notification.permission === 'denied') return;
      if (Notification.permission === 'granted') {
        new Notification(`@${fromUserName} 在 ${groupName} 中提到了你`, { body: messagePreview });
      } else {
        Notification.requestPermission().then(perm => {
          if (perm === 'granted') {
            new Notification(`@${fromUserName} 在 ${groupName} 中提到了你`, { body: messagePreview });
          }
        });
      }
    };

    // 注册送达回调到 SocketContext，保存取消订阅函数
    const unsubDelivered = registerDelivered(onDelivered);

    socket.on('new_message', onMsg);
    socket.on('new_message_batch', onMsgBatch);
    socket.on('mentioned', onAtMention);
    socket.on('typing', onTyping);
    socket.on('stop_typing', onStopTyping);
    socket.on('message_deleted', onDeleted);
    socket.on('message_vanished', onVanished);
    socket.on('messages_batch_deleted', onBatchDeleted);
    socket.on('conversation_messages_cleared', onCleared);
    socket.on('message_edited', onEdited);
    socket.on('message_reaction', onReaction);
    socket.on('message_read', onRead);
    // message_delivered 已通过 registerDelivered(onDelivered) 注册到 SocketContext，不重复注册
    // socket.on('red_packet_claimed', onRedPacketClaimed); // removed
    socket.on('group_updated', onGroupUpdated);
    const onRoleChanged = ({ conversationId, role }) => {
      if (conversationId !== convIdRef.current) return;
      setMyGroupRole(role);
    };
    socket.on('role_changed', onRoleChanged);
    socket.on('group_kicked', onGroupKicked);
    socket.on('group_dismissed', onGroupDismissed);
    socket.on('group_settings_updated', onGroupSettingsUpdated);
    socket.on('message_pinned', onPinned);
    socket.on('message_unpinned', onUnpinned);
    return () => {
      unsubDelivered?.(); // 取消订阅，防止已卸载的组件收到送达回执
      socket.off('mentioned', onAtMention);
      socket.off('new_message', onMsg);
      socket.off('new_message_batch', onMsgBatch);
      socket.off('typing', onTyping);
      socket.off('stop_typing', onStopTyping);
      socket.off('message_deleted', onDeleted);
      socket.off('message_vanished', onVanished);
      socket.off('messages_batch_deleted', onBatchDeleted);
      socket.off('conversation_messages_cleared', onCleared);
      socket.off('message_edited', onEdited);
      socket.off('message_reaction', onReaction);
      socket.off('message_read', onRead);
      socket.off('group_updated', onGroupUpdated);
      socket.off('role_changed', onRoleChanged);
      socket.off('group_kicked', onGroupKicked);
      socket.off('group_dismissed', onGroupDismissed);
      socket.off('group_settings_updated', onGroupSettingsUpdated);
      socket.off('message_pinned', onPinned);
      socket.off('message_unpinned', onUnpinned);
    };
  }, [socket, conversation.id, user.id, onClose]);

  // ── 重发失败消息（复用 pendingMsgsRef + ack 机制）─────────────
  const retryMessage = useCallback((failedMsg) => {
    if (!socket) return;
    const newTempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setMessages(prev =>
      prev.map(m => m._tempId === failedMsg._tempId
        ? { ...m, _status: 'sending', _tempId: newTempId }
        : m
      )
    );
    const timer = setTimeout(() => {
      pendingMsgsRef.current.delete(newTempId);
      setMessages(prev => prev.map(m => m._tempId === newTempId ? { ...m, _status: 'error' } : m));
    }, 5000);
    pendingMsgsRef.current.set(newTempId, timer);
    socket.emit('send_message', {
      conversationId: failedMsg.conversation_id,
      content:        failedMsg.content,
      type:           failedMsg.type,
      reply_to_id:    failedMsg.reply_to_id || null,
      clientMsgId:    failedMsg.id, // 复用首发的 tempId 作幂等键:重发若原消息已落库,后端去重不产生重复
    }, (ack) => {
      clearTimeout(pendingMsgsRef.current.get(newTempId));
      pendingMsgsRef.current.delete(newTempId);
      if (ack?.success && ack.message) {
        confirmedMsgIds.current.add(ack.message.id);
        setMessages(prev => prev.map(m => m._tempId === newTempId ? { ...ack.message } : m));
      } else {
        setMessages(prev => prev.map(m => m._tempId === newTempId ? { ...m, _status: 'error' } : m));
      }
    });
  }, [socket]);

  claimingRef.current = claiming;

  // 打开红包：拉详情，未领且未领完则先领取，再展示详情
  const openRedPacket = useCallback(async (packetId) => {
    if (!packetId || claimingRef.current) return;
    setClaiming(true);
    try {
      let { data: detail } = await axios.get(`/api/redpackets/${packetId}`);
      let justClaimed = false;
      const finished = detail.claimed_count >= detail.total_count;
      const isSender = String(detail.sender_id) === String(user.id);
      // 发送者不领自己的红包（仅看详情）
      if (!detail.myClaim && !finished && !isSender) {
        try {
          await axios.post(`/api/redpackets/${packetId}/claim`);
          justClaimed = true;
          ({ data: detail } = await axios.get(`/api/redpackets/${packetId}`));
        } catch (e) {
          // 已领完/已过期等：仍展示详情，错误金额由后端透传
          ({ data: detail } = await axios.get(`/api/redpackets/${packetId}`));
        }
      }
      setRedPacketDetail({ ...detail, justClaimed });
    } catch (e) {
      showToast(e.response?.data?.error || '红包打开失败', 'error');
    } finally {
      setClaiming(false);
    }
  }, []); // stable - reads claiming via claimingRef

  const sendMessage = async () => {
    const text = input.trim();
    if (!text) return;
    // 防 Enter 连击：500ms 内相同内容只发一次
    const now = Date.now();
    if (text === lastSendRef.current.text && now - lastSendRef.current.time < 500) return;
    lastSendRef.current = { text, time: now };

    // ── 编辑模式 ──
    if (editingMsg) {
      if (input.trim() === editingMsg.content) { cancelEdit(); return; }
      try {
        await axios.put(`/api/messages/${editingMsg.id}/edit`, { content: input.trim() });
        cancelEdit();
      } catch (e) { showToast(e.response?.data?.error || '编辑失败', 'error'); }
      return;
    }

    if (!socket) return;
    const content   = input.trim();
    const tempId    = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const replySnap = replyTo ? { ...replyTo } : null;

    // 1. 立刻渲染乐观消息（带 loading 状态）
    const optimistic = {
      id:              tempId,
      conversation_id: conversation.id,
      sender_id:       user.id,
      senderName:      user.username,
      senderAvatar:    user.avatar,
      content,
      type:            'text',
      file_url:        '',
      created_at:      Math.floor(Date.now() / 1000),
      reply_to_id:     replySnap?.id || null,
      replyTo:         replySnap,
      deleted:         0,
      edited:          0,
      reactions:       [],
      _status:         'sending',
      _tempId:         tempId,
    };
    forceScrollRef.current = true; // 自己发消息：无条件滚到底(多帧贴底 effect 接管)
    setMessages(prev => [...prev, optimistic]);
    setInput('');
    localStorage.removeItem(`draft_${conversation.id}`);
    setReplyTo(null);
    setShowEmoji(false);
    socket.emit('stop_typing', { conversationId: conversation.id });

    // 2. 5s 超时 → 标记失败
    const timer = setTimeout(() => {
      pendingMsgsRef.current.delete(tempId);
      setMessages(prev => prev.map(m => m._tempId === tempId ? { ...m, _status: 'error' } : m));
    }, 5000);
    pendingMsgsRef.current.set(tempId, timer);

    // 3. 发送并等待 socket.io ack（后端已在 send_message handler 中调用 ack()）
    const msgClientId = `perf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    window.__vxinPerf?.send(msgClientId, user.id, conversation.id);
    socket.emit('send_message', {
      conversationId: conversation.id,
      content,
      type:           'text',
      reply_to_id:    replySnap?.id || null,
      clientMsgId:    tempId, // 幂等键:后端据(sender_id,client_msg_id)去重,弱网重发不产生重复消息
    }, (ack) => {
      clearTimeout(pendingMsgsRef.current.get(tempId));
      pendingMsgsRef.current.delete(tempId);
      if (ack?.success && ack.message) {
        window.__vxinPerf?.ack(msgClientId, user.id);
        // 把真实 id 存入 confirmed，防止 new_message 广播重复添加
        confirmedMsgIds.current.add(ack.message.id);
        setMessages(prev => prev.map(m => m._tempId === tempId ? { ...ack.message } : m));
      } else {
        setMessages(prev => prev.map(m => m._tempId === tempId ? { ...m, _status: 'error' } : m));
      }
    });
  };

  // ── 分享名片：发送一条 contact_card 消息（content 为被分享用户的 JSON 快照）──
  const openCardPicker = () => {
    setShowMore(false);
    axios.get('/api/users/contacts').then(r => setCardContacts(r.data || [])).catch(() => setCardContacts([]));
    setShowCardPicker(true);
  };

  const sendContactCard = (contact) => {
    if (!socket) return;
    setShowCardPicker(false);
    const card = {
      uid: contact.id,
      username: contact.remark || contact.username || '',
      avatar: contact.avatar || '',
      wechat_id: contact.wechat_id || '',
    };
    const content = JSON.stringify(card);
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const optimistic = {
      id: tempId, conversation_id: conversation.id, sender_id: user.id,
      senderName: user.username, senderAvatar: user.avatar,
      content, type: 'contact_card', file_url: '',
      created_at: Math.floor(Date.now() / 1000),
      reply_to_id: null, replyTo: null, deleted: 0, edited: 0, reactions: [],
      _status: 'sending', _tempId: tempId,
    };
    forceScrollRef.current = true; // 自己发名片：无条件滚到底
    setMessages(prev => [...prev, optimistic]);
    const timer = setTimeout(() => {
      pendingMsgsRef.current.delete(tempId);
      setMessages(prev => prev.map(m => m._tempId === tempId ? { ...m, _status: 'error' } : m));
    }, 5000);
    pendingMsgsRef.current.set(tempId, timer);
    socket.emit('send_message', { conversationId: conversation.id, content, type: 'contact_card', clientMsgId: tempId }, (ack) => {
      clearTimeout(pendingMsgsRef.current.get(tempId));
      pendingMsgsRef.current.delete(tempId);
      if (ack?.success && ack.message) {
        confirmedMsgIds.current.add(ack.message.id);
        setMessages(prev => prev.map(m => m._tempId === tempId ? { ...ack.message } : m));
      } else {
        setMessages(prev => prev.map(m => m._tempId === tempId ? { ...m, _status: 'error' } : m));
      }
    });
  };

  const startEdit = (msg) => {
    setEditingMsg({ id: msg.id, content: msg.content });
    setInput(msg.content);
    setReplyTo(null);
    setTimeout(() => { textareaRef.current?.focus(); textareaRef.current?.select(); }, 50);
  };

  const cancelEdit = () => {
    setEditingMsg(null);
    setInput('');
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    // @ mention
    if (atList) {
      const filtered = atList.filter(m => m.id !== user.id);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAtIndex(prev => Math.min(prev + 1, filtered.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAtIndex(prev => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (filtered[atIndex]) {
          insertAtMention(filtered[atIndex]);
        }
        return;
      }
      if (e.key === 'Escape') {
        setAtList(null);
        return;
      }
      if (e.key !== '@') {
        setAtList(null);
      }
    }

    if (e.key === '@' && conversation.type === 'group') {
      setAtList(members);
      setAtIndex(0);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
      return;
    }
    socket?.emit('typing', { conversationId: conversation.id });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socket?.emit('stop_typing', { conversationId: conversation.id }), 2000);
  };

  const insertAtMention = (member) => {
    // prev 末尾是用户按 @ 键写入的 '@'，替换掉它再拼上完整提及
    setInput(prev => prev.endsWith('@') ? prev.slice(0, -1) + `@${member.username} ` : prev + `@${member.username} `);
    setAtList(null);
    textareaRef.current?.focus();
  };

  // ── 云存储直传（XHR 支持进度回调）─────────────────────────────
  const uploadToCloud = useCallback(async (fileOrBlob, contentType, filename, onProgress) => {
    const { data } = await axios.post('/api/upload/credential', {
      filename, contentType, conversationId: conversation.id,
    });
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress?.(Math.round(e.loaded / e.total * 100));
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(data.publicUrl);
        else reject(new Error(`上传失败 (HTTP ${xhr.status})，请检查 Bucket CORS 配置`));
      });
      xhr.addEventListener('error', () => reject(new Error('网络错误，上传失败')));
      xhr.addEventListener('abort', () => reject(new Error('上传已取消')));
      xhr.open('PUT', data.uploadUrl);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.send(fileOrBlob);
    });
  }, [conversation.id]);

  // ── 聊天专属背景：设置/清除（按会话）──────────────────────────
  const setChatBackground = useCallback((url) => {
    return axios.put(`/api/messages/conversation/${conversation.id}/background`, { background: url })
      .then(() => setConversation(prev => ({ ...prev, background: url })))
      .catch(() => { showToast('设置失败', 'error'); });
  }, [conversation.id]);

  const pickBackground = useCallback(() => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) { showToast('请选择图片', 'error'); return; }
      try {
        const url = await uploadToCloud(file, file.type, file.name);
        await setChatBackground(url);
        showToast('已设置聊天背景');
      } catch (e) {
        // 聊天背景需公开URL,只能走云存储;未配置(503)/直传失败时给明确提示而非笼统"网络错误"
        const msg = e.response?.status === 503
          ? '设置背景需服务器开启云存储'
          : (e.message || '设置失败');
        showToast(msg, 'error');
      }
    };
    inp.click();
  }, [uploadToCloud, setChatBackground]);

  // ── 本地上传回退：云存储未配置(503)时，直传后端 /upload（入库+广播由后端完成）──
  const uploadLocal = useCallback(async (file, onProgress) => {
    const form = new FormData();
    form.append('file', file);
    if (replyTo?.id) form.append('reply_to_id', replyTo.id);
    await axios.post(`/api/messages/${conversation.id}/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => { if (e.total) onProgress?.(Math.round(e.loaded / e.total * 100)); },
    });
  }, [conversation.id, replyTo]);

  // ── 分片 / 断点续传上传（大文件，云存储未配置时的本地大文件通道）──
  const uploadChunked = useCallback(async (file, onProgress) => {
    // SHA-256 增量计算（避免将整个文件读入内存）
    const hashBuf = await new Promise((resolve, reject) => {
      const reader = file.stream().getReader();
      const subtle = crypto.subtle;
      // Web Crypto 不支持增量，但用 TransformStream 流式读取后一次 digest 仍比 arrayBuffer 省一半内存
      // 方案：先 init，服务端可跳过 hash 校验（hash 为空时服务端仍接受）
      // 这里仍计算 hash 但只对 ≤50MB 的文件做，大文件跳过以节省内存
      resolve(null);
    });
    let hash = '';
    if (file.size <= 50 * 1024 * 1024) {
      const buf = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    const { data: init } = await axios.post(`/api/messages/${conversation.id}/upload-init`, {
      filename: file.name, size: file.size, hash, mime: file.type || 'application/octet-stream',
    });
    const chunkSize = init.chunkSize || 4 * 1024 * 1024;
    let received = init.received || 0; // 断点续传起点
    while (received < file.size) {
      const end = Math.min(received + chunkSize, file.size);
      // 使用 file.slice 逐片读取，不将整个文件载入内存
      const slice = await file.slice(received, end).arrayBuffer();
      let attempt = 0;
      for (;;) {
        try {
          const { data } = await axios.put(
            `/api/messages/${conversation.id}/upload-chunk/${init.uploadId}?offset=${received}`,
            slice, { headers: { 'Content-Type': 'application/octet-stream' } }
          );
          received = data.received;
          break;
        } catch (e) {
          // 偏移不一致(409) → 以服务端 received 为准续传；其它错误最多重试 3 次
          if (e.response?.status === 409 && typeof e.response.data?.received === 'number') {
            received = e.response.data.received; break;
          }
          if (++attempt >= 3) throw e;
          await new Promise(r => setTimeout(r, 500 * attempt));
        }
      }
      onProgress?.(Math.round(received / file.size * 100));
    }
    await axios.post(`/api/messages/${conversation.id}/upload-finish/${init.uploadId}`,
      replyTo?.id ? { reply_to_id: replyTo.id } : {});
  }, [conversation.id, replyTo]);

  // ── 统一文件处理入口（handleFileUpload / handleDrop 共用）────
  const handleFileSelect = useCallback(async (file) => {
    // 阻断并发上传：防止用户疯狂拖入多个文件
    if (isUploadingRef.current) {
      setUploadState(s => ({
        ...(s || { name: file.name, progress: 0 }),
        status: 'error',
        errorMsg: `请等待"${isUploadingRef.current}"上传完成后再发送`,
      }));
      return;
    }

    // ── 前端校验（统一走内联错误，不用 alert）────────────────────
    const showErr = (msg) =>
      setUploadState({ name: file.name, progress: 0, status: 'error', errorMsg: msg });

    if (!ALLOWED_MIME_SET.has(file.type)) {
      showErr(`不支持的文件类型：${file.type || '未知'}，请上传图片/文档/音视频/压缩包`);
      return;
    }
    const ext = file.name.includes('.') ? ('.' + file.name.split('.').pop()).toLowerCase() : '';
    if (BLOCKED_EXTENSIONS.has(ext)) {
      showErr(`禁止上传可执行文件（${ext}）`);
      return;
    }
    // 单文件硬上限 100 MB（2GB 视频在此被拦截，杜绝浏览器 OOM）
    if (file.size > 100 * 1024 * 1024) {
      showErr(`文件超过 100MB 限制（当前 ${(file.size / 1024 / 1024).toFixed(1)} MB）`);
      return;
    }

    const onProg = (p) => setUploadState(s => s ? { ...s, progress: p } : null);
    const doUpload = async () => {
      isUploadingRef.current = file.name;
      setUploadState({ name: file.name, progress: 0, status: 'uploading' });
      const type = file.type.startsWith('image/') ? 'image'
                 : file.type.startsWith('audio/') ? 'voice'
                 : file.type.startsWith('video/') ? 'video'
                 : 'file';
      try {
        let publicUrl;
        try {
          publicUrl = await uploadToCloud(file, file.type, file.name, onProg);
        } catch (cloudErr) {
          // 云直传失败 → 一律回退本地上传(后端自己入库+广播,无需再 emit)。
          // 不止 503(云存储未配置)：Electron CSP 拦截云域名 / CORS / 云不可达 都会
          // 抛无 .response 的网络错误,此前只认 503 导致这些情况直接报"网络错误"上传失败。
          // 本地上传走后端 /upload,CSP 必放行,是可靠兜底。
          // 大文件(>8MB)走分片/断点续传,突破单次上限并支持断点续传。
          const status = cloudErr.response?.status;
          const isClientAbort = status === 400 || status === 403; // 真正的参数/权限错,不该回退
          if (!isClientAbort) {
            if (file.size > 8 * 1024 * 1024) await uploadChunked(file, onProg);
            else await uploadLocal(file, onProg);
            isUploadingRef.current = false;
            setUploadState(null);
            setReplyTo(null);
            forceScrollRef.current = true;
            setTimeout(() => (() => { const o = listOuterRef.current; if (o) o.scrollTo({ top: o.scrollHeight, behavior: 'smooth' }); })(), 100);
            return;
          }
          throw cloudErr;
        }
        isUploadingRef.current = false;
        setUploadState(null);
        if (!socket) { showToast('连接已断开，请重连后重试', 'error'); return; }
        socket.emit('send_file_message', {
          conversationId: conversation.id, type,
          file_url: publicUrl, content: file.name,
          reply_to_id: replyTo?.id || null,
          clientMsgId: `f_${publicUrl}`, // 幂等键:同一上传URL只落库一次
        }, (res) => { if (!res?.success) showToast(res?.error || '文件消息发送失败', 'error'); });
        setReplyTo(null);
        setTimeout(() => (() => { const o = listOuterRef.current; if (o) o.scrollTo({ top: o.scrollHeight, behavior: 'smooth' }); })(), 100);
      } catch (err) {
        isUploadingRef.current = false;
        const errorMsg = err.response?.data?.error || err.message || '上传失败';
        setUploadState({ name: file.name, progress: 0, status: 'error', errorMsg, retryFn: doUpload });
      }
    };
    await doUpload();
  }, [uploadToCloud, uploadLocal, socket, conversation.id, replyTo, listOuterRef]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) handleFileSelect(file);
  };

  // 粘贴图片直接发送（截图 / 输入法表情包等剪贴板里的图片）
  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const blob = it.getAsFile();
        if (!blob) continue;
        e.preventDefault();  // 阻止把图片当文本/文件名塞进输入框
        const ext = (it.type.split('/')[1] || 'png').split('+')[0];
        const named = new File([blob], blob.name && blob.name !== 'image.png'
          ? blob.name : `paste-${Date.now()}.${ext}`, { type: it.type });
        handleFileSelect(named);
        return;
      }
    }
  }, [handleFileSelect]);

  // 发送表情包（后端创建 image 消息并广播，发送方经 socket 回显）
  const sendSticker = useCallback((stickerId) => {
    setShowStickers(false);
    axios.post('/api/stickers/send', { conversationId: conversation.id, stickerId })
      .then(() => setTimeout(() => (() => { const o = listOuterRef.current; if (o) o.scrollTo({ top: o.scrollHeight, behavior: 'smooth' }); })(), 80))
      .catch(err => showToast(err.response?.data?.error || '发送失败', 'error'));
  }, [conversation.id, listOuterRef]);

  // 拖拽上传
  const handleDragEnter = (e) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setIsDragOver(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragOver(false);
  };
  const handleDragOver = (e) => { e.preventDefault(); };
  const handleDrop = (e) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  // Voice recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        if (blob.size < 1000) { stream.getTracks().forEach(t => t.stop()); return; } // too short
        setUploadState({ name: '语音', progress: 0, status: 'uploading' });
        const onProg = (p) => setUploadState(s => s ? { ...s, progress: p } : null);
        try {
          let publicUrl;
          try {
            publicUrl = await uploadToCloud(blob, 'audio/webm', 'voice.webm', onProg);
          } catch (cloudErr) {
            // 与图片/文件一致:云直传失败(非400/403)回退本地上传(走后端/upload,CSP必放行)。
            // 修复"未配置云存储/Electron CSP拦截时语音消息100%失败"。
            const status = cloudErr.response?.status;
            if (status === 400 || status === 403) throw cloudErr;
            const voiceFile = new File([blob], 'voice.webm', { type: 'audio/webm' });
            await uploadLocal(voiceFile, onProg); // 后端入库+广播,无需再 emit
            setUploadState(null);
            forceScrollRef.current = true;
            setTimeout(() => (() => { const o = listOuterRef.current; if (o) o.scrollTo({ top: o.scrollHeight, behavior: 'smooth' }); })(), 100);
            stream.getTracks().forEach(t => t.stop());
            return;
          }
          setUploadState(null);
          forceScrollRef.current = true;
          socket?.emit('send_file_message', {
            conversationId: conversation.id,
            type:     'voice',
            file_url: publicUrl,
            content:  'voice.webm',
            clientMsgId: `f_${publicUrl}`, // 幂等键:同一上传URL只落库一次
          }, (res) => { if (!res?.success) showToast(res?.error || '语音发送失败', 'error'); });
          setTimeout(() => (() => { const o = listOuterRef.current; if (o) o.scrollTo({ top: o.scrollHeight, behavior: 'smooth' }); })(), 100);
        } catch { setUploadState({ name: '语音', progress: 0, status: 'error', errorMsg: '发送失败' }); }
        stream.getTracks().forEach(t => t.stop());
      };
      try {
        recorder.start();
      } catch (e) {
        stream.getTracks().forEach(t => t.stop());
        throw e;
      }
      recorderRef.current = recorder;
      setRecording(true);
    } catch { showToast('无法访问麦克风', 'error'); }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  const fallbackCopy = (text) => {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(el);
    el.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(el);
  };

  const handleContextMenu = (e, msg) => {
    if (msg.deleted) return;
    e.preventDefault();
    e.stopPropagation();

    // 🔥 改进的菜单位置计算（使用Portal后固定到viewport）
    let x = e.clientX;
    let y = e.clientY;

    // 菜单尺寸：宽度~220px，高度~280px
    const MENU_WIDTH = 220;
    const MENU_HEIGHT = 280;
    const PADDING = 10;

    // 右边界检查
    if (x + MENU_WIDTH + PADDING > window.innerWidth) {
      x = window.innerWidth - MENU_WIDTH - PADDING;
    }

    // 下边界检查
    if (y + MENU_HEIGHT + PADDING > window.innerHeight) {
      y = window.innerHeight - MENU_HEIGHT - PADDING;
    }

    // 上边界检查
    if (y < PADDING) {
      y = PADDING;
    }

    setCtxMenu({ x, y, msg });
  };

  const closeCtx = () => setCtxMenu(null);

  // 🔥 点击外部关闭菜单
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = () => closeCtx();
    document.addEventListener('click', handler);
    document.addEventListener('contextmenu', handler);
    return () => {
      document.removeEventListener('click', handler);
      document.removeEventListener('contextmenu', handler);
    };
  }, [ctxMenu]);

  const ctxAction = async (action) => {
    const msg = ctxMenu?.msg;
    if (!msg) return;
    closeCtx();

    switch (action) {
      case 'reply':
        setReplyTo(msg); setEditingMsg(null);
        textareaRef.current?.focus();
        break;

      case 'addSticker':
        try {
          await axios.post('/api/stickers/collect', { url: msg.file_url });
          showToast('已添加到我的表情', 'success');
        } catch (e) { showToast(e.response?.data?.error || '添加失败', 'error'); }
        break;

      case 'copy':
        if (msg.type === 'text') {
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(msg.content).catch(() => fallbackCopy(msg.content));
          } else {
            fallbackCopy(msg.content);
          }
        } else {
          showToast('只有文字消息可以复制');
        }
        break;

      case 'edit':
        if (msg.sender_id !== user.id) { showToast('只能编辑自己的消息'); return; }
        if (msg.type !== 'text') { showToast('只能编辑文字消息'); return; }
        if ((Math.floor(Date.now() / 1000) - msg.created_at) > 120) { showToast('超过2分钟，无法编辑'); return; }
        startEdit(msg);
        break;

      case 'forward':
        setForwardMsg(msg);
        break;

      case 'multiselect':
        setMultiSelect(true);
        setSelectedMsgs(new Set([msg.id]));
        break;

      case 'pin': {
        const already = pinnedMessages.some(p => p.msgId === msg.id);
        if (already) {
          await axios.delete(`/api/messages/conversation/${conversation.id}/pin-message/${msg.id}`).catch(e => showToast(e.response?.data?.error || '操作失败', 'error'));
        } else {
          await axios.post(`/api/messages/conversation/${conversation.id}/pin-message`, { msgId: msg.id }).catch(e => showToast(e.response?.data?.error || '操作失败', 'error'));
        }
        break;
      }

      case 'delete': {
        const isOwn = msg.sender_id === user.id;
        const isAdmin = myGroupRole === 'owner' || myGroupRole === 'admin';
        const prompt = isOwn ? '确认撤回这条消息？' : '删除该消息（对全员生效）？';
        if ((isOwn || (isAdmin && conversation.type === 'group')) && await showConfirm(prompt)) {
          await axios.delete(`/api/messages/${msg.id}`, { data: { forEveryone: true } }).catch(() => {});
        }
        break;
      }

      case 'vanish': {
        const isOwn = msg.sender_id === user.id;
        const isAdmin = myGroupRole === 'owner' || myGroupRole === 'admin';
        if (!isOwn && !isAdmin) break;
        if (!(await showConfirm('彻底删除这条消息？对方也不会看到任何提示，且无法恢复。'))) break;
        // 乐观：先播动画，再发请求（由 socket 广播 message_vanished 驱动最终状态）
        playShredAnimation(msg.id, () => {
          setMessages(prev => prev.filter(m => m.id !== msg.id));
        });
        await axios.delete(`/api/messages/${msg.id}`, { data: { vanish: true } }).catch(() => {});
        break;
      }

      default:
        if (action === 'collect') {
          const extra = msg.file_url ? { file_url: msg.file_url } : {};
          await axios.post('/api/users/me/collections', { type: msg.type === 'text' ? 'text' : msg.type === 'image' ? 'image' : msg.type === 'video' ? 'video' : 'file', content: msg.content || msg.file_url || '', extra })
            .then(() => showToast('已收藏', 'success'))
            .catch(e => showToast(e.response?.data?.error || '收藏失败', 'error'));
        } else if (action.startsWith('react:')) {
          await axios.post(`/api/messages/${msg.id}/react`, { emoji: action.replace('react:', '') }).catch(() => {});
        }
    }
  };

  // 多选辅助
  const toggleMsgSelect = (msgId) => {
    setSelectedMsgs(prev => { const s = new Set(prev); s.has(msgId) ? s.delete(msgId) : s.add(msgId); return s; });
  };
  const multiForward = () => {
    const msgs = messages.filter(m => selectedMsgs.has(m.id));
    if (msgs.length === 1) { setForwardMsg(msgs[0]); setMultiSelect(false); setSelectedMsgs(new Set()); }
    else showToast('请逐条转发（每次选一条）');
  };
  const multiDelete = async () => {
    if (!await showConfirm(`确认撤回/删除选中的 ${selectedMsgs.size} 条消息？`)) return;
    await axios.post('/api/messages/batch-delete', { msgIds: [...selectedMsgs], conversationId: conversation.id }).catch(e => showToast(e.response?.data?.error || '操作失败', 'error'));
    setMultiSelect(false); setSelectedMsgs(new Set());
  };

  const playVoice = (url) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    const a = new Audio(url);
    audioRef.current = a;
    a.onended = () => { audioRef.current = null; };
    a.play().catch(() => { audioRef.current = null; });
  };

  // Precompute the last mine message id to avoid O(n) per message in flatItems
  const lastMineId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender_id === user.id && !messages[i].deleted) return messages[i].id;
    }
    return null;
  }, [messages, user.id]);

  // Build flat items array with per-item caching to preserve object identity for unchanged messages.
  // Unchanged items keep the same reference → VirtualRow memo skips re-render.
  const flatItems = useMemo(() => {
    const cache = itemCacheRef.current;
    const newCache = new Map();
    const items = [];
    let lastTime = 0;
    let prevSenderId = null;

    for (const msg of messages) {
      let dividerInserted = false;
      if (msg.created_at - lastTime > 300) {
        const key = `t_${msg.id}`;
        const cached = cache.get(key);
        const divider = (cached && cached.time === msg.created_at)
          ? cached
          : { type: 'divider', key, time: msg.created_at };
        newCache.set(key, divider);
        items.push(divider);
        lastTime = msg.created_at;
        dividerInserted = true;
      }
      // 同一发送者、且中间无时间分割线 → 连续消息（隐藏重复头像、收紧间距）
      const consecutive = !dividerInserted && prevSenderId === msg.sender_id && !msg.deleted;
      prevSenderId = msg.sender_id;

      const isMine = msg.sender_id === user.id;
      const isLastMine = isMine && msg.id === lastMineId;
      const isSelected = multiSelect && selectedMsgs.has(msg.id);
      const isHighlighted = highlightedMsgId === String(msg.id);
      const recalledContent = msg.deleted ? (recalledMessages[msg.id] || null) : null;

      const cached = cache.get(msg.id);
      let item;
      if (cached
        && cached.msg === msg
        && cached.isLastMine === isLastMine
        && cached.isSelected === isSelected
        && cached.isHighlighted === isHighlighted
        && cached.multiSelect === multiSelect
        && cached.convType === conversation.type
        && cached.groupSettings === groupSettings
        && cached.myGroupRole === myGroupRole
        && cached.members === members
        && cached.claiming === claiming
        && cached.pinnedMessages === pinnedMessages
        && cached.recalledContent === recalledContent
        && cached.consecutive === consecutive
      ) {
        item = cached;
      } else {
        item = {
          type: 'message',
          key: msg.id,
          msg,
          consecutive,
          isMine,
          isLastMine,
          isSelected,
          isHighlighted,
          multiSelect,
          convType: conversation.type,
          convId: conversation.id,
          userId: user.id,
          groupSettings,
          myGroupRole,
          members,
          claiming,
          pinnedMessages,
          recalledContent,
        };
      }

      newCache.set(msg.id, item);
      items.push(item);
    }

    itemCacheRef.current = newCache;
    return items;
  }, [messages, multiSelect, selectedMsgs, highlightedMsgId, conversation.id,
      conversation.type, pinnedMessages, myGroupRole, members, groupSettings,
      user.id, claiming, lastMineId, recalledMessages]);

  // 当 pendingScrollId 所指消息随 messages 更新进入 flatItems 后，执行实际滚动
  useEffect(() => {
    if (!pendingScrollId) return;
    const idx = flatItems.findIndex(it => it.type === 'message' && it.msg?.id === pendingScrollId);
    if (idx >= 0) {
      requestAnimationFrame(() => {
        virtListRef.current?.scrollToItem(idx, 'center');
        setHighlightedMsgId(String(pendingScrollId));
        setTimeout(() => setHighlightedMsgId(null), 2000);
      });
      setPendingScrollId(null);
    }
  }, [pendingScrollId, flatItems]);

  // Stable callbacks ref - MessageItem reads from this ref when rendering
  const callbacksRef = useRef(null);
  if (!callbacksRef.current) callbacksRef.current = {};
  callbacksRef.current.handleContextMenu = handleContextMenu;
  callbacksRef.current.toggleMsgSelect = (msgId) =>
    setSelectedMsgs(prev => { const s = new Set(prev); s.has(msgId) ? s.delete(msgId) : s.add(msgId); return s; });
  callbacksRef.current.retryMessage = retryMessage;
  callbacksRef.current.setLightboxUrl = (clickedUrl) => {
    // 收集会话内所有图片做画廊左右切换。flatItems 的项 type 是 'message'/'divider',
    // 图片在 it.msg.type==='image'(此前误用 it.type==='image' 恒空→画廊只能看单张)。
    const imageUrls = flatItems
      .filter(it => it.type === 'message' && it.msg?.type === 'image' && it.msg.file_url)
      .map(it => mediaUrl(it.msg.file_url));
    const idx = imageUrls.indexOf(clickedUrl);
    setLightboxState({ urls: imageUrls, idx: idx >= 0 ? idx : 0 });
  };
  callbacksRef.current.setHighlightedMsgId = setHighlightedMsgId;
  callbacksRef.current.setShowUserProfile = setShowUserProfile;
  callbacksRef.current.openRedPacket = openRedPacket;
  // 拍一拍：双击对方头像，服务端落库并广播系统消息
  callbacksRef.current.onNudge = (targetId) => {
    socket?.emit('nudge', { conversationId: conversation.id, targetId });
  };
  callbacksRef.current.onReedit = (msgId, content) => {
    setInput(content);
    setTimeout(() => textareaRef.current?.focus(), 0);
    setRecalledMessages(prev => { const n = { ...prev }; delete n[msgId]; return n; });
  };
  callbacksRef.current.onImageLoad = () => {
    const outer = listOuterRef.current;
    if (outer && outer.scrollHeight - outer.scrollTop - outer.clientHeight < 200)
      outer.scrollTo({ top: outer.scrollHeight, behavior: 'smooth' });
  };
  callbacksRef.current.scrollToMsg = async (msgId) => {
    const idx = flatItems.findIndex(it => it.type === 'message' && it.msg?.id === msgId);
    if (idx >= 0) {
      virtListRef.current?.scrollToItem(idx, 'center');
      setHighlightedMsgId(String(msgId));
      setTimeout(() => setHighlightedMsgId(null), 2000);
      return;
    }
    const el = document.getElementById(`msg-${msgId}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    // 消息不在当前窗口，从服务端加载上下文
    try {
      const { data } = await axios.get(`/api/messages/${conversation.id}/around/${msgId}`);
      if (!data?.messages?.length) { showToast('无法定位该消息', 'info'); return; }
      setMessages(data.messages);
      setHasMore(data.hasMore);
      setPendingScrollId(msgId);
    } catch {
      showToast('无法定位该消息', 'info');
    }
  };


  const memberCount = conversation.type === 'group' ? (members.length || '') : null;

  /* ── SVG icon helpers ── */
  const IcoVoiceCall = () => <svg viewBox="0 0 24 24"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>;
  const IcoVideoCall = () => <svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>;
  const IcoInfo = () => <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>;
  const IcoEmoji = () => <svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg>;
  const IcoMic = () => <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1 1.93c-3.94-.49-7-3.85-7-7.93h2c0 3.31 2.69 6 6 6s6-2.69 6-6h2c0 4.08-3.06 7.44-7 7.93V19h3v2H9v-2h3v-3.07z"/></svg>;
  const IcoImage = () => <svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>;
  const IcoFile = () => <svg viewBox="0 0 24 24"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>;
  const IcoMore = () => <svg viewBox="0 0 24 24"><path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>;
  const IcoPerson = () => <svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>;

  return (
    <div
      className="wc-chat"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* ── 拖拽上传遮罩 ── */}
      {isDragOver && (
        <div className="wc-drag-overlay">
          <svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg>
          <span>拖放文件到此处上传</span>
        </div>
      )}
      {/* ── 图片灯箱（画廊模式） ── */}
      {lightboxState && (
        <ImagePreview
          urls={lightboxState.urls}
          initialIdx={lightboxState.idx}
          url={lightboxState.urls[lightboxState.idx]}
          onClose={() => setLightboxState(null)}
        />
      )}
      {groupCall && (
        <GroupCallModal
          socket={socket}
          user={user}
          session={groupCall}
          onClose={() => setGroupCall(null)}
        />
      )}
      {groupCallInvite && !groupCall && (
        <div style={{ position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 2100, background: '#2c2c2e', color: 'var(--text-inverse)', borderRadius: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 8px 28px rgba(0,0,0,.4)' }}>
          <span style={{ fontSize: 14 }}>
            {groupCallInvite.fromName || '群成员'} 发起了群{groupCallInvite.type === 'video' ? '视频' : '语音'}通话
          </span>
          <button onClick={joinGroupCall} style={{ background: 'var(--green,#07C160)', color: 'var(--text-inverse)', border: 0, borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}>加入</button>
          <button onClick={() => setGroupCallInvite(null)} style={{ background: 'transparent', color: 'rgba(255,255,255,.6)', border: 0, cursor: 'pointer' }}>忽略</button>
        </div>
      )}
      {/* ── Header ── */}
      <div className="wc-chat-header">
        <button className="wc-chat-header-back wc-back-btn" onClick={onClose} title="返回">
          <svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
        </button>
        <div className="wc-header-name-container">
          <div className="wc-chat-header-name" data-testid="chat-title">
            {conversation.name || '聊天'}
            {memberCount
              ? <span className="wc-header-member-count">({memberCount})</span>
              : null
            }
          </div>
          {conversation.type === 'private' && conversation.otherUser?.status === 'online' && (
            <div className="wc-chat-header-sub">在线</div>
          )}
        </div>
        <div className="wc-chat-header-right">
          {/* 顶栏对齐微信：去搜索/查看资料(资料点名字即可看)，仅保留通话与更多 */}
          {conversation.type === 'private' && <>
            <button className="wc-chat-header-btn" data-testid="chat-call-audio-btn" title="语音通话" onClick={() => startCall('audio')}><IcoVoiceCall /></button>
            <button className="wc-chat-header-btn" data-testid="chat-call-video-btn" title="视频通话" onClick={() => startCall('video')}><IcoVideoCall /></button>
          </>}
          {conversation.type === 'group' && <>
            <button className="wc-chat-header-btn" title="群语音通话" onClick={() => startGroupCall('audio')}><IcoVoiceCall /></button>
            <button className="wc-chat-header-btn" title="群视频通话" onClick={() => startGroupCall('video')}><IcoVideoCall /></button>
          </>}
          <button
            className={`wc-chat-header-btn${showGroupInfo ? ' active' : ''}`}
            title={conversation.type === 'group' ? '群聊信息' : '更多'}
            data-testid="chat-group-info-btn"
            onClick={() => setShowGroupInfo(v => !v)}
          ><IcoMore /></button>
        </div>
      </div>

      {/* ── 搜索消息面板 ── */}
      {showMsgSearch && (
        <div className="wc-search-panel">
          <div className="wc-search-bar">
            <div className="wc-search-input-wrap">
              <svg viewBox="0 0 24 24" className="wc-search-icon"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
              <input
                autoFocus
                value={msgSearchQ}
                onChange={e => { setMsgSearchQ(e.target.value); searchMessages(e.target.value); }}
                placeholder="搜索聊天记录..."
                aria-label="搜索聊天记录"
                className="wc-search-input"
                onKeyDown={e => e.key === 'Escape' && setShowMsgSearch(false)}
              />
              {msgSearchQ && <button className="wc-search-close-btn" onClick={() => { setMsgSearchQ(''); setMsgSearchResults([]); }} aria-label="清空搜索">✕</button>}
            </div>
            <button className="wc-search-cancel-btn" onClick={() => setShowMsgSearch(false)}>关闭</button>
          </div>
          {/* 搜索结果 */}
          {msgSearchQ && (
            <div className="wc-search-results">
              {msgSearching && <div className="wc-search-status" role="status">搜索中…</div>}
              {!msgSearching && msgSearchResults.length === 0 && msgSearchQ && (
                <div className="wc-search-status" role="status">未找到相关记录</div>
              )}
              {msgSearchResults.map(msg => {
                const q = msgSearchQ.toLowerCase();
                const idx = msg.content.toLowerCase().indexOf(q);
                return (
                  <div
                    key={msg.id}
                    className="wc-search-result-item"
                    onClick={() => {
                      const exists = messages.find(m => m.id === msg.id);
                      if (!exists) setMessages(prev => {
                        const idx = prev.findIndex(m => m.created_at > msg.created_at);
                        const entry = { ...msg, _highlighted: true };
                        return idx >= 0 ? [...prev.slice(0, idx), entry, ...prev.slice(idx)] : [...prev, entry];
                      });
                      setTimeout(() => callbacksRef.current.scrollToMsg(msg.id), 100);
                    }}
                    role="button" tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && (() => {
                      const exists = messages.find(m => m.id === msg.id);
                      if (!exists) setMessages(prev => {
                        const idx = prev.findIndex(m => m.created_at > msg.created_at);
                        const entry = { ...msg, _highlighted: true };
                        return idx >= 0 ? [...prev.slice(0, idx), entry, ...prev.slice(idx)] : [...prev, entry];
                      });
                      setTimeout(() => callbacksRef.current.scrollToMsg(msg.id), 100);
                    })()}
                  >
                    <div className="wc-search-result-body">
                      <div className="wc-search-result-meta">
                        <span className="wc-search-result-sender">{msg.senderName}</span>
                        <span className="wc-search-result-time">
                          {(() => {
                            const d = new Date(msg.created_at * 1000);
                            const opts = d.getFullYear() !== new Date().getFullYear()
                              ? { year: 'numeric', month: 'short', day: 'numeric' }
                              : { month: 'short', day: 'numeric' };
                            return d.toLocaleDateString('zh-CN', opts);
                          })()}
                        </span>
                      </div>
                      <div className="wc-search-result-preview">
                        {idx >= 0 ? (
                          <>
                            {msg.content.slice(0, idx)}
                            <span className="wc-search-result-highlight">{msg.content.slice(idx, idx + msgSearchQ.length)}</span>
                            {msg.content.slice(idx + msgSearchQ.length)}
                          </>
                        ) : msg.content}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 置顶消息 Banner ── */}
      {pinnedMessages.length > 0 && (
        <div className="wc-pinned-banner"
          onClick={() => setShowPinnedDetail(v => !v)}>
          <span className="wc-pinned-badge">📌 置顶</span>
          <span className="wc-pinned-text">
            {pinnedMessages[0]?.type === 'image' ? '[图片]' : pinnedMessages[0]?.content}
          </span>
          {pinnedMessages.length > 1 && <span className="wc-pinned-count">+{pinnedMessages.length - 1}</span>}
          <span className="wc-pinned-toggle">{showPinnedDetail ? '▲' : '▼'}</span>
        </div>
      )}
      {showPinnedDetail && pinnedMessages.length > 0 && (
        <div className="wc-pinned-detail">
          {pinnedMessages.map(p => (
            <div key={p.msgId} className="wc-pinned-item">
              <span className="wc-pinned-item-icon">📌</span>
              <div className="wc-pinned-item-body">
                <div className="wc-pinned-item-meta">{p.senderName} · 由{p.pinnedByName}置顶</div>
                <div className="wc-pinned-item-text">{p.type === 'image' ? '[图片]' : p.content}</div>
              </div>
              <button className="wc-unpin-btn"
                onClick={e => { e.stopPropagation(); axios.delete(`/api/messages/conversation/${conversation.id}/pin-message/${p.msgId}`); }}>
                取消置顶
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Body ── */}
      <div className="wc-messages-wrap" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Messages virtual list + overlays */}
        <div
          className="wc-messages-virt"
          style={conversation.background ? {
            backgroundImage: `url(${mediaUrl(conversation.background)})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          } : undefined}
        >
          {loadingMore && (
            <div className="wc-search-status" role="status" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, background: 'rgba(245,245,245,.92)', textAlign: 'center', padding: '6px 0', fontSize: 12 }}>加载中...</div>
          )}
          <VirtualMessageList
            ref={virtListRef}
            outerRef={listOuterRef}
            items={flatItems}
            cbRef={callbacksRef}
          />
          {typingName && (
            <div className="cw-typing" style={{ position: 'absolute', bottom: 4, left: 20, right: 20, pointerEvents: 'none', zIndex: 1 }}>
              <span></span><span></span><span></span> {typingName} 正在输入
            </div>
          )}
          {showScrollBtn && (
            <button
              className="cw-scroll-bottom"
              onClick={() => virtListRef.current?.scrollToBottom('smooth')}
              aria-label="滚动到底部"
            ></button>
          )}
        </div>

        {showGroupInfo && conversation.type === 'group' && (
          <GroupInfo
            conversation={conversation}
            currentUserId={user.id}
            onClose={() => setShowGroupInfo(false)}
            onPickBackground={pickBackground}
            onClearBackground={() => setChatBackground('')}
            onLeave={() => { setShowGroupInfo(false); onClose?.(); }}
            onConvUpdate={(data) => {
              setConversation(prev => ({ ...prev, ...data }));
              if (data.mute_all !== undefined || data.no_private_chat !== undefined) {
                setGroupSettings(prev => ({ ...prev, ...data }));
              }
            }}
            onCleared={() => { setMessages([]); setPinnedMessages([]); }}
          />
        )}
        {showGroupInfo && conversation.type === 'private' && (
          <PrivateChatSettings
            conversation={conversation}
            onClose={() => setShowGroupInfo(false)}
            onConvUpdate={(data) => setConversation(prev => ({ ...prev, ...data }))}
            onPickBackground={pickBackground}
            onClearBackground={() => setChatBackground('')}
            onCleared={() => { setMessages([]); setPinnedMessages([]); }}
          />
        )}
      </div>

      {/* User profile modal */}
      {showUserProfile && (
        <UserProfile
          userId={showUserProfile}
          onClose={() => setShowUserProfile(null)}
          onStartChat={() => setShowUserProfile(null)}
          onFriendDeleted={() => { setShowUserProfile(null); onClose?.(); }}
        />
      )}

      {/* ── 分享名片：联系人选择器 ── */}
      {showCardPicker && (
        <div
          className="wc-card-picker-overlay"
          onClick={e => e.target === e.currentTarget && setShowCardPicker(false)}
        >
          <div className="wc-card-picker">
            <div className="wc-card-picker-header">
              <span className="wc-card-picker-title">选择要分享的名片</span>
              <button className="wc-card-picker-close" onClick={() => setShowCardPicker(false)} aria-label="关闭名片选择">✕</button>
            </div>
            <div className="wc-card-picker-list">
              {cardContacts.length === 0 && (
                <div className="wc-card-picker-empty">暂无联系人</div>
              )}
              {cardContacts.map(c => (
                <div key={c.id} onClick={() => sendContactCard(c)}
                  className="wc-card-picker-item"
                  role="button" tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && sendContactCard(c)}>
                  <Avatar src={c.avatar} name={c.remark || c.username} size={42} style={{ borderRadius: 6 }} />
                  <div className="wc-card-picker-item-info">
                    <div className="wc-card-picker-item-name">{c.remark || c.username}</div>
                    {c.wechat_id && <div className="wc-card-picker-item-wechat">v信号：{c.wechat_id}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── 文件上传进度条 ── */}
      {uploadState && (
        <div className={`wc-upload-bar ${uploadState.status === 'error' ? 'wc-upload-bar-error' : 'wc-upload-bar-progress'}`}>
          {uploadState.status === 'uploading' ? (
            <>
              <span className="wc-upload-icon wc-upload-icon-ok">📤</span>
              <div className="wc-upload-body">
                <div className="wc-upload-name">
                  {uploadState.name} · {uploadState.progress}%
                </div>
                <div className="wc-upload-track">
                  <div className="wc-upload-fill" style={{ width: `${uploadState.progress}%` }} />
                </div>
              </div>
            </>
          ) : (
            <>
              <span className="wc-upload-icon wc-upload-icon-fail">❌</span>
              <div className="wc-upload-error-text">
                {uploadState.errorMsg || '上传失败'}
              </div>
              {uploadState.retryFn && (
                <button
                  className="wc-retry-btn"
                  onClick={uploadState.retryFn}
                >
                  重试
                </button>
              )}
              <button
                className="wc-cancel-upload-btn"
                onClick={() => setUploadState(null)}
                aria-label="取消上传"
              >✕</button>
            </>
          )}
        </div>
      )}

      {/* ── 编辑模式指示条 ── */}
      {editingMsg && (
        <div className="wc-edit-bar">
          <div className="wc-edit-bar-body">
            <div className="wc-edit-bar-label">编辑消息</div>
            <div className="wc-edit-bar-text">{editingMsg.content}</div>
          </div>
          <button className="wc-edit-cancel-btn" onClick={cancelEdit} aria-label="取消编辑">✕</button>
        </div>
      )}

      {/* ── Reply preview bar ── */}
      {replyTo && !editingMsg && (
        <div className="wc-reply-bar">
          <div className="wc-reply-bar-body">
            <div className="wc-reply-bar-name">回复 {replyTo.senderName}</div>
            <div className="wc-reply-bar-text">
              {replyTo.type === 'image' ? '[图片]' : replyTo.type === 'voice' ? '[语音]' : replyTo.type === 'video' ? '[视频]' : replyTo.type === 'red_packet' ? '[红包]' : replyTo.type === 'file' ? '[文件]' : replyTo.content}
            </div>
          </div>
          <button className="wc-reply-bar-close" onClick={() => setReplyTo(null)} aria-label="取消回复">✕</button>
        </div>
      )}

      {/* ── 转发弹窗 ── */}
      {forwardMsg && (
        <ForwardModal message={forwardMsg} onClose={() => setForwardMsg(null)} />
      )}

      {/* ── 多选模式底部工具栏 ── */}
      {multiSelect && (
        <div className="wc-multiselect-bar">
          <button className="wc-ms-cancel-btn" onClick={() => { setMultiSelect(false); setSelectedMsgs(new Set()); }}>取消</button>
          <span className="wc-ms-count">已选 {selectedMsgs.size} 条</span>
          <div className="wc-ms-btn-group">
            <button className="wc-ms-btn-primary wc-ms-btn-forward" onClick={multiForward} disabled={selectedMsgs.size === 0}>转发</button>
            <button className="wc-ms-btn-primary wc-ms-btn-delete" onClick={multiDelete} disabled={selectedMsgs.size === 0}>撤回</button>
          </div>
        </div>
      )}

      {/* ── 全群禁言提示（普通成员被禁言时替换输入区） ── */}
      {!multiSelect && conversation.type === 'group' && groupSettings.mute_all && myGroupRole === 'member' ? (
        <div className="wc-mute-notice">
          <span>🔇 全员禁言已开启，只有群主和管理员可以发送消息</span>
        </div>
      ) : (
      /* ── Input area ── */
      <div className="wc-input-area" ref={inputAreaRef}>
        {/* Toolbar */}
        <div className="wc-input-toolbar">
          <button
            className={`wc-tool-btn${showEmoji ? ' active' : ''}`}
            title="表情"
            onClick={() => { setShowEmoji(v => !v); setShowMore(false); setShowStickers(false); }}
          ><IcoEmoji /></button>

          <button
            className={`wc-tool-btn${showStickers ? ' active' : ''}`}
            title="表情包"
            onClick={() => { setShowStickers(v => !v); setShowEmoji(false); setShowMore(false); }}
          ><svg viewBox="0 0 24 24" className="wc-tool-svg"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h10l6-6V5c0-1.1-.9-2-2-2zM9 11c-.83 0-1.5-.67-1.5-1.5S8.17 8 9 8s1.5.67 1.5 1.5S9.83 11 9 11zm3.5 5c-2.33 0-4.31-1.46-5.11-3.5h10.22c-.8 2.04-2.78 3.5-5.11 3.5zM15 11c-.83 0-1.5-.67-1.5-1.5S14.17 8 15 8s1.5.67 1.5 1.5S15.83 11 15 11zm-1 9.5V15h5.5L14 20.5z"/></svg></button>

          <button
            className={`wc-tool-btn${voiceMode ? ' active' : ''}`}
            title={voiceMode ? '切换文字' : '语音输入'}
            onClick={() => setVoiceMode(v => !v)}
          ><IcoMic /></button>

          <label className="wc-tool-btn wc-tool-label" title="图片">
            <IcoImage />
            <input type="file" data-testid="chat-attach-image" accept="image/jpeg,image/png,image/gif,image/webp" className="wc-hidden-input" onChange={handleFileUpload} />
          </label>

          <label className="wc-tool-btn wc-tool-label" title="文件">
            <IcoFile />
            <input
              type="file"
              data-testid="chat-attach-file"
              ref={fileInputRef}
              className="wc-hidden-input"
              accept="image/*,audio/*,video/mp4,video/quicktime,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip,application/x-rar-compressed,text/plain"
              onChange={handleFileUpload}
            />
          </label>

          {/* 截图按钮（Electron 桌面端） */}
          {window.__ELECTRON_CONFIG__ && (
            <button
              className="wc-tool-btn"
              title="截图 (Ctrl+Alt+A)"
              onClick={async () => {
                const base64 = await import('../utils/electron').then(m => m.triggerScreenshot());
                if (!base64) return;
                // 将截图作为文件上传
                const blob = await (await fetch(base64)).blob();
                const file = new File([blob], `screenshot-${Date.now()}.png`, { type: 'image/png' });
                // 复用文件上传逻辑
                const hiddenInput = document.createElement('input');
                hiddenInput.type = 'file';
                const dt = new DataTransfer();
                dt.items.add(file);
                hiddenInput.files = dt.files;
                handleFileUpload({ target: hiddenInput });
              }}
            ><svg viewBox="0 0 24 24" className="wc-tool-svg"><path d="M3 5v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2zm16 0v14H5V5h14zm-2 4.5c0 .83-.67 1.5-1.5 1.5S14 10.33 14 9.5 14.67 8 15.5 8s1.5.67 1.5 1.5zM12 19l5-6H7l5 6z"/></svg></button>
          )}

          <button
            className="wc-tool-btn"
            title="发红包"
            onClick={() => { setShowRedPacket(true); setShowMore(false); setShowEmoji(false); }}
          ><svg viewBox="0 0 24 24" style={{ width: 22, height: 22, fill: 'currentColor' }}><path d="M19 6h-2V4c0-.9-.7-1.7-1.6-1.9.4-1.2 1.5-2 2.9-2 1.7 0 3 1.3 3 3 0 .5-.1 1-.3 1.4h.9c.6 0 1.2.4 1.2 1v2c0 .6-.5 1-1.2 1zm-2 4h4v8.5c0 1-.8 1.9-1.8 1.9H2.8C1.8 20.4 1 19.5 1 18.5V6c0-.5.3-1 .8-1.4L17 4v6zM4 14c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm10 0c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2z"/></svg></button>

          <button
            className={`wc-tool-btn${showMore ? ' active' : ''}`}
            title="更多"
            onClick={() => { setShowMore(v => !v); setShowEmoji(false); }}
          ><IcoMore /></button>
        </div>

        {/* More panel */}
        {showMore && (
          <div className="wc-more-panel">
            {[
              { bg:'#8A93A6', svg:<svg viewBox="0 0 24 24" style={{width:24,height:24,fill:'var(--text-inverse)'}}><path d="M12 15.2A3.2 3.2 0 008.8 12 3.2 3.2 0 0012 8.8 3.2 3.2 0 0115.2 12 3.2 3.2 0 0112 15.2M12 7a5 5 0 000 10A5 5 0 0012 7m0-5c0 0-8.02 0-9.5 1.5S1 7 1 12s0 8 1.5 9.5S7 23 12 23s8 0 9.5-1.5S23 17 23 12s0-8-1.5-9.5S17 1 12 1m0 20c-5 0-9-4-9-9s4-9 9-9 9 4 9 9-4 9-9 9z"/></svg>, label:'相机', action: async () => {
                setShowMore(false);
                // Capacitor 移动端通过 window.__takePhoto__ 调用原生相机
                // Web 端回退到文件选择
                const cam = window.__takePhoto__;
                if (typeof cam === 'function') {
                  const dataUrl = await cam();
                  if (!dataUrl) return;
                  try {
                    const blob = await (await fetch(dataUrl)).blob();
                    const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
                    handleFileUpload({ target: { files: [file] } });
                  } catch {}
                } else {
                  document.querySelector('input[accept*="image"]')?.click();
                }
              } },
              { bg:'#8A93A6', svg:<svg viewBox="0 0 24 24" style={{width:24,height:24,fill:'var(--text-inverse)'}}><path d="M20 6h-2.18c.07-.44.18-.88.18-1.36C18 2.05 15.96 0 13.5 0c-1.3 0-2.47.6-3.28 1.53L9 3 7.78 1.53C6.97.6 5.8 0 4.5 0 2.04 0 0 2.05 0 4.64c0 .48.11.92.18 1.36H0v2h20v-2zM20 10H4v8c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8z"/></svg>, label:'文件', action:()=>fileInputRef.current?.click() },
              { bg:'#8A93A6', svg:<svg viewBox="0 0 24 24" style={{width:24,height:24,fill:'var(--text-inverse)'}}><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>, label:'视频通话', testid:'chat-call-video-btn', action:()=>{ setShowMore(false); startCall('video'); } },
              { bg:'var(--green)', svg:<svg viewBox="0 0 24 24" style={{width:24,height:24,fill:'var(--text-inverse)'}}><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>, label:'语音通话', testid:'chat-call-audio-btn', action:()=>{ setShowMore(false); startCall('audio'); } },
              { bg:'#8A93A6', svg:<svg viewBox="0 0 24 24" style={{width:24,height:24,fill:'var(--text-inverse)'}}><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>, label:'名片', action: openCardPicker },
            ].map(item => (
              <div key={item.label} data-testid={item.testid} className="wc-more-item" onClick={item.action}>
                <div className="wc-more-icon" style={{ background: item.bg }}>{item.svg}</div>
                <span className="wc-more-label">{item.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Emoji panel — 在输入框上方展开，输入框始终可见 */}
        {showEmoji && <EmojiPicker onSelect={e => { setInput(prev => prev + e); textareaRef.current?.focus(); }} />}
        {showStickers && <StickerPanel onSend={sendSticker} />}

        {/* Text / Voice input — 始终显示 */}
        {!showMore && (
          <>
            {voiceMode ? (
              <div className="wc-voice-container">
                <button
                  data-testid="chat-voice-btn"
                  className={`wc-voice-btn${recording ? ' recording' : ''}`}
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onTouchStart={startRecording}
                  onTouchEnd={stopRecording}
                >
                  {recording ? '● 松开发送' : '按住说话'}
                </button>
              </div>
            ) : (
              <div className="wc-input-box wc-input-box-relative">
                {atList && (
                  <div className="wc-at-list">
                    {atList.filter(m => m.id !== user.id).map((m, i) => (
                      <div
                        key={m.id}
                        className={`wc-at-list-item${i === atIndex ? ' active' : ''}`}
                        onClick={() => insertAtMention(m)}>
                        <Avatar src={m.avatar} name={m.username} size={22} />
                        <span>{m.username}</span>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  data-testid="chat-msg-input"
                  className="wc-textarea"
                  aria-label="输入消息"
                  value={input}
                  onChange={e => {
                    const val = e.target.value;
                    setInput(val);
                    if (conversation.id) {
                      localStorage.setItem(`draft_${conversation.id}`, val);
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder=""
                  rows={3}
                />
              </div>
            )}
            {!voiceMode && (
              <div className="wc-input-footer">
                <button
                  data-testid="chat-send-btn"
                  className={`wc-send-btn${input.trim() ? ' active' : ''}`}
                  onClick={sendMessage}
                  disabled={!input.trim()}
                >发送</button>
              </div>
            )}
          </>
        )}
      </div>
      )} {/* end mute_all conditional */}









      {/* Context menu */}
      {ctxMenu && createPortal(
        <>
          <div
            className="wc-ctx-overlay wc-ctx-overlay-fixed"
            onClick={closeCtx}
          />
          <div
            className="wc-ctx-menu wc-ctx-menu-fixed"
            style={{
              left: ctxMenu.x + 'px',
              top: ctxMenu.y + 'px',
            }}>
            <div className="wc-ctx-emoji-row">
              {REACTIONS.map(e => (
                <span key={e} className="wc-ctx-emoji" onClick={() => ctxAction(`react:${e}`)}>{e}</span>
              ))}
            </div>
            <div className="wc-ctx-divider" />
            <div className="wc-ctx-item" data-testid="ctx-reply" onClick={() => ctxAction('reply')}>回复</div>
            {/* 编辑：仅限自己的文字消息，2分钟内 */}
            {ctxMenu.msg.sender_id === user.id &&
             ctxMenu.msg.type === 'text' &&
             !ctxMenu.msg.deleted &&
             (Math.floor(Date.now()/1000) - ctxMenu.msg.created_at) <= 120 && (
              <div className="wc-ctx-item" data-testid="ctx-edit" onClick={() => ctxAction('edit')}>编辑</div>
            )}
            {ctxMenu.msg.type === 'text' && (
              <div className="wc-ctx-item" onClick={() => ctxAction('copy')}>复制</div>
            )}
            {/* 转发：所有类型消息都可转发 */}
            <div className="wc-ctx-item" data-testid="ctx-forward" onClick={() => ctxAction('forward')}>转发</div>
            {/* 收藏功能暂在前端隐藏（逻辑保留，改为 true 即可恢复入口） */}
            {false && (
              <div className="wc-ctx-item" onClick={() => ctxAction('collect')}>收藏</div>
            )}
            <div className="wc-ctx-item" onClick={() => ctxAction('pin')}>
              {pinnedMessages.some(p => p.msgId === ctxMenu.msg.id) ? '取消置顶' : '置顶消息'}
            </div>
            {ctxMenu.msg.type === 'image' && (
              <div className="wc-ctx-item" onClick={() => ctxAction('addSticker')}>添加到表情</div>
            )}
            <div className="wc-ctx-divider" />
            {/* 撤回：自己的消息不限时间，或群主/管理员删除任意消息 */}
            {(ctxMenu.msg.sender_id === user.id ||
              ((myGroupRole === 'owner' || myGroupRole === 'admin') && conversation.type === 'group')
            ) && (
              <div className="wc-ctx-item danger" data-testid="ctx-recall" onClick={() => ctxAction('delete')}>
                {ctxMenu.msg.sender_id === user.id ? '撤回' : '删除'}
              </div>
            )}
            {/* 删除不留痕迹：自己的消息，或群主/管理员 */}
            {(ctxMenu.msg.sender_id === user.id ||
              ((myGroupRole === 'owner' || myGroupRole === 'admin') && conversation.type === 'group')
            ) && (
              <div className="wc-ctx-item danger" data-testid="ctx-vanish" onClick={() => ctxAction('vanish')}>
                删除不留痕迹
              </div>
            )}
          </div>
        </>,
        document.body
      )}

      {showRedPacket && (
        <RedPacketModal
          conversation={conversation}
          onClose={() => setShowRedPacket(false)}
          onSent={() => {
            // 红包消息由 socket 事件自动添加，这里不需要手动处理
            setInput('');
          }}
        />
      )}
      {redPacketDetail && (
        <div
          onClick={() => setRedPacketDetail(null)}
          className="wc-rp-detail-overlay"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="wc-rp-detail-card"
          >
            <div className="wc-rp-detail-header">
              <div className="wc-rp-detail-icon">🧧</div>
              <div className="wc-rp-detail-sender">{redPacketDetail.senderName} 的红包</div>
              <div className="wc-rp-detail-greeting">{redPacketDetail.greeting}</div>
            </div>
            <div className="wc-rp-detail-body">
              {redPacketDetail.myClaim ? (
                <div className="wc-rp-center">
                  {redPacketDetail.justClaimed && <div className="wc-rp-claimed-label">领取成功</div>}
                  <span className="wc-rp-amount">{redPacketDetail.myClaim.amount}</span>
                  <span className="wc-rp-unit">金币</span>
                </div>
              ) : String(redPacketDetail.sender_id) === String(user.id) ? (
                <div className="wc-rp-center">
                  <div className="wc-rp-claimed-label">你发出的红包</div>
                  <span className="wc-rp-amount">{redPacketDetail.total_amount}</span>
                  <span className="wc-rp-unit">金币</span>
                </div>
              ) : (
                <div className="wc-rp-expired">
                  {redPacketDetail.claimed_count >= redPacketDetail.total_count ? '手慢了，红包派完了' : '红包已过期'}
                </div>
              )}
              <div className="wc-rp-stats">
                已领取 {redPacketDetail.claimed_count}/{redPacketDetail.total_count} 个
              </div>
              <div className="wc-rp-claims-list">
                {(redPacketDetail.claims || []).map(c => (
                  <div key={c.id || c.user_id} className="wc-rp-claim-item">
                    <span className="wc-rp-claim-name">{c.username}{c.user_id === user.id ? '（我）' : ''}</span>
                    <span className="wc-rp-claim-amount">{c.amount} 金币</span>
                  </div>
                ))}
              </div>
            </div>
            <div
              onClick={() => setRedPacketDetail(null)}
              className="wc-rp-close-btn"
            >关闭</div>
          </div>
        </div>
      )}

    </div>
  );
}


const BURN_OPTIONS = [
  { value: 0,      label: '关闭' },
  { value: 10,     label: '10秒' },
  { value: 30,     label: '30秒' },
  { value: 60,     label: '1分钟' },
  { value: 300,    label: '5分钟' },
  { value: 3600,   label: '1小时' },
  { value: 86400,  label: '24小时' },
  { value: 604800, label: '7天' },
];

function PrivateChatSettings({ conversation, onClose, onConvUpdate, onPickBackground, onClearBackground, onCleared }) {
  const [muted, setMuted] = useState(!!conversation.muted);
  const [pinned, setPinned] = useState(!!conversation.pinned);
  const [burnAfter, setBurnAfter] = useState(conversation.burn_after || 0);
  const [saving, setSaving] = useState(false);

  const toggleMute = async (val) => {
    setSaving(true);
    try {
      await axios.post(`/api/messages/conversation/${conversation.id}/mute`, { muted: val ? 1 : 0 });
      setMuted(val);
      onConvUpdate?.({ muted: val ? 1 : 0 });
    } catch { showToast('操作失败', 'error'); }
    setSaving(false);
  };

  const togglePin = async (val) => {
    setSaving(true);
    try {
      await axios.post(`/api/messages/conversation/${conversation.id}/pin`, { pinned: val ? 1 : 0 });
      setPinned(val);
      onConvUpdate?.({ pinned: val ? 1 : 0 });
    } catch { showToast('操作失败', 'error'); }
    setSaving(false);
  };

  const clearMessages = async () => {
    const name = conversation.name || '当前聊天';
    if (!await showConfirm(`确认双向删除「${name}」的全部聊天记录？对方也将看不到这些记录。`)) return;
    setSaving(true);
    try {
      await axios.delete(`/api/messages/conversation/${conversation.id}/messages`);
      onCleared?.();
      onClose?.();
    } catch (err) {
      showToast(err.response?.data?.error || '清理失败', 'error');
    }
    setSaving(false);
  };

  const changeBurnAfter = async (val) => {
    const s = parseInt(val) || 0;
    setBurnAfter(s);
    try {
      await axios.post(`/api/messages/conversation/${conversation.id}/burn-after`, { seconds: s });
      onConvUpdate?.({ burn_after: s });
    } catch { showToast('设置失败', 'error'); }
  };

  return (
    <div className="wc-settings-panel">
      <div className="wc-settings-header">
        <span className="wc-settings-header-title">聊天设置</span>
        <button className="wc-settings-close-btn" onClick={onClose} aria-label="关闭窗口">✕</button>
      </div>
      <div className="wc-settings-body">
        <div className="wc-settings-section-mt">
          <div className="wc-settings-row">
            <span className="wc-settings-row-label">消息免打扰</span>
            <div onClick={() => !saving && toggleMute(!muted)}
              className={`wc-settings-toggle${muted ? ' on' : ' off'}${saving ? ' saving' : ''}`}>
              <div className={`wc-settings-toggle-thumb${muted ? ' on' : ' off'}`} />
            </div>
          </div>
          <div className="wc-settings-row">
            <span className="wc-settings-row-label">置顶聊天</span>
            <div onClick={() => !saving && togglePin(!pinned)}
              className={`wc-settings-toggle${pinned ? ' on' : ' off'}${saving ? ' saving' : ''}`}>
              <div className={`wc-settings-toggle-thumb${pinned ? ' on' : ' off'}`} />
            </div>
          </div>
          <div className="wc-settings-row wc-settings-row-clickable" onClick={() => onPickBackground?.()}>
            <span className="wc-settings-row-label">设置聊天背景</span>
            <span className="wc-settings-row-action">{conversation.background ? '更换 ›' : '选择图片 ›'}</span>
          </div>
          {conversation.background && (
            <div className="wc-settings-row wc-settings-row-clickable" onClick={() => onClearBackground?.()}>
              <span className="wc-settings-row-label" style={{ color: 'var(--color-badge)' }}>清除聊天背景</span>
            </div>
          )}
          <div className="wc-settings-row">
            <span className="wc-settings-row-label">阅后即焚</span>
            <select
              value={burnAfter}
              onChange={e => changeBurnAfter(e.target.value)}
              className="wc-settings-select"
              style={{ fontSize: 13, color: burnAfter > 0 ? 'var(--green)' : 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              {BURN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <button
          onClick={clearMessages}
          disabled={saving}
          className="wc-settings-clear-btn"
        >
          双向删除聊天记录
        </button>
      </div>
    </div>
  );
}
