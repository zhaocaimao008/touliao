import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import { GroupAvatar } from './GroupInfo';

const gsHlCls = 'gs-highlight';

function highlight(text, q) {
  const s = String(text || '');
  if (!q) return s;
  const lower = s.toLowerCase();
  const parts = [];
  let from = 0;
  let i = lower.indexOf(q, from);
  // 高亮全部命中(此前只高亮首个,后续同名片段被漏标)
  while (i >= 0) {
    if (i > from) parts.push(s.slice(from, i));
    parts.push(<span key={i} className={gsHlCls}>{s.slice(i, i + q.length)}</span>);
    from = i + q.length;
    i = lower.indexOf(q, from);
  }
  if (parts.length === 0) return s;
  if (from < s.length) parts.push(s.slice(from));
  return <>{parts}</>;
}

export default function GlobalSearch({ query, onSelectConv, onNetworkSearch }) {
  const [contacts, setContacts] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [searchingMsg, setSearchingMsg] = useState(false);
  const [convError, setConvError] = useState(null);

  useEffect(() => {
    axios.get('/api/users/contacts')
      .then(r => {
        setContacts(r.data || []);
      })
      .catch(err => {
        // [GlobalSearch] Failed to load contacts — suppressed
      });

    axios.get('/api/messages/conversations')
      .then(r => {
        setConversations(r.data || []);
        setConvError(null);
      })
      .catch(err => {
        const errorMsg = err.response?.status === 401
          ? '认证失败，请重新登录'
          : err.response?.data?.error || err.message;
        // [GlobalSearch] Failed to load conversations — suppressed
        setConvError(errorMsg);
      });
  }, []);

  const q = query.trim().toLowerCase();

  // 搜会话名(联系人、群聊、文件传输助手)
  const matchedContacts = useMemo(() => {
    if (!q) return [];
    return contacts.filter(c =>
      (c.remark || '').toLowerCase().includes(q) ||
      (c.username || '').toLowerCase().includes(q) ||
      (c.wechat_id || '').toLowerCase().includes(q)
    );
  }, [contacts, q]);

  const matchedConversations = useMemo(() => {
    if (!q) return [];
    let results = conversations.filter(c => {
      const nameMatch = (c.name || '').toLowerCase().includes(q);
      const typeMatch = c.type === 'group' || c.type === 'filehelper';
      return nameMatch && typeMatch;
    });

    // 如果搜索词匹配"文件传输助手"但列表中没有，添加虚拟的 filehelper
    const fileHelperName = '文件传输助手';
    const hasFileHelper = conversations.some(c => c.type === 'filehelper');
    if (!hasFileHelper && fileHelperName.toLowerCase().includes(q)) {
      results = [...results, {
        id: '__file-helper__',
        type: 'filehelper',
        name: fileHelperName,
        avatar: '',
      }];
    }
    return results;
  }, [conversations, q]);

  // 搜历史消息(防抖 300ms，减少请求次数)
  useEffect(() => {
    if (!q || q.length < 1) { setMessages([]); return; }
    // AbortController：快速输入时取消上一次未完成请求，防止慢响应覆盖新结果（旧数据竞态）
    const ac = new AbortController();
    const timer = setTimeout(() => {
      setSearchingMsg(true);
      axios.get(`/api/messages/search?q=${encodeURIComponent(q)}&limit=20`, { signal: ac.signal })
        .then(r => {
          const msgs = (r.data.results || []).map(m => ({
            ...m,
            preview: m.content,
            msgType: m.type,
          }));
          setMessages(msgs);
        })
        .catch(err => { if (!axios.isCancel?.(err) && err.code !== 'ERR_CANCELED') setMessages([]); })
        .finally(() => { if (!ac.signal.aborted) setSearchingMsg(false); });
    }, 300);
    return () => { clearTimeout(timer); ac.abort(); };
  }, [q]);

  const openContact = async (c) => {
    try {
      const { data } = await axios.post('/api/messages/conversation/private', { userId: c.id });
      onSelectConv({ id: data.conversationId, type: 'private', name: c.remark || c.username, avatar: c.avatar, otherUser: c });
    } catch {}
  };

  const openConversation = (conv) => {
    onSelectConv(conv);
  };

  const openMessageLocation = (msg) => {
    // 定位到消息：打开会话 + 滚到消息位置
    const convObj = {
      id: msg.conversation_id,
      type: msg.convType,
      name: msg.convName,
      avatar: msg.avatar || '',
      scrollToId: msg.id,
    };
    if (msg.otherUser) convObj.otherUser = msg.otherUser;
    onSelectConv(convObj);
  };

  const empty = matchedContacts.length === 0 && matchedConversations.length === 0 && messages.length === 0;

  return (
    <div className="gs-scroll">
      {/* 会话加载失败提示（此前静默吞掉，导致会话搜索结果为空却无任何反馈） */}
      {convError && (
        <div role="alert" className="gs-searching" style={{ color: 'var(--color-badge)' }}>
          {convError}
        </div>
      )}
      {/* 联系人 */}
      {matchedContacts.length > 0 && (
        <>
          <div className="gs-cat">联系人</div>
          {matchedContacts.map(c => (
            <div key={c.id} className="gs-row" onClick={() => openContact(c)}
              role="button" tabIndex={0}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openContact(c))}>
              <Avatar src={c.avatar} name={c.remark || c.username} size={42} />
              <div className="gs-info">
                <div className="gs-name">{highlight(c.remark || c.username, q)}</div>
                {c.remark && c.username && c.username.toLowerCase().includes(q) && (
                  <div className="gs-sub">昵称：{highlight(c.username, q)}</div>
                )}
                {c.wechat_id && c.wechat_id.toLowerCase().includes(q) && (
                  <div className="gs-sub">v信号：{highlight(c.wechat_id, q)}</div>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {/* 会话(群聊、文件传输助手等) */}
      {matchedConversations.length > 0 && (
        <>
          <div className="gs-cat">
            {matchedConversations.every(c => c.type === 'filehelper') ? '文件传输助手'
              : matchedConversations.every(c => c.type === 'group') ? '群聊'
              : '会话'}
          </div>
          {matchedConversations.map(g => (
            <div key={g.id} className="gs-row" onClick={() => openConversation(g)}
              role="button" tabIndex={0}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openConversation(g))}>
              {g.type === 'filehelper' ? (
                <div className="gs-filehelper-icon">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="var(--text-inverse)"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
                </div>
              ) : (
                <GroupAvatar members={g.members || []} avatar={g.avatar} size={42} />
              )}
              <div className="gs-info">
                <div className="gs-name">{highlight(g.name, q)}</div>
                {g.group_number && <div className="gs-sub">群号 {g.group_number}</div>}
              </div>
            </div>
          ))}
        </>
      )}

      {/* 历史消息 */}
      {messages.length > 0 && (
        <>
          <div className="gs-cat">聊天记录 ({messages.length})</div>
          {messages.map(m => (
            <div key={m.id} className="gs-row" onClick={() => openMessageLocation(m)}
              role="button" tabIndex={0}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openMessageLocation(m))}>
              <Avatar src={m.senderAvatar} name={m.senderName} size={42} />
              <div className="gs-info">
                <div className="gs-msg-meta">
                  {m.senderName} {m.convType === 'group' ? `在「${m.convName}」` : ''}
                </div>
                <div className="gs-msg-text">
                  {highlight(m.preview || m.content, q)}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {searchingMsg && (
        <div role="status" className="gs-searching">搜索中…</div>
      )}

      {/* 降级兜底：仅在有实际查询词时展示,避免清空输入时闪出「去网络搜索『』」空串 */}
      {empty && !searchingMsg && q && (
        <div
          onClick={() => onNetworkSearch(query)}
          className="gs-network-row"
          role="button" tabIndex={0}
          onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onNetworkSearch(query))}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="var(--green)" className="gs-network-icon"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
          <span>未找到相关本地结果，去网络搜索添加<span className="gs-highlight">「{query}」</span></span>
        </div>
      )}
    </div>
  );
}
