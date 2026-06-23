import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import { GroupAvatar } from './GroupInfo';

const gsHlCls = 'gs-highlight';

function highlight(text, q) {
  const s = String(text || '');
  const i = s.toLowerCase().indexOf(q);
  if (i < 0 || !q) return s;
  return (
    <>
      {s.slice(0, i)}
      <span className={gsHlCls}>{s.slice(i, i + q.length)}</span>
      {s.slice(i + q.length)}
    </>
  );
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
    const timer = setTimeout(() => {
      setSearchingMsg(true);
      axios.get(`/api/messages/search?q=${encodeURIComponent(q)}&limit=20`)
        .then(r => {
          const msgs = (r.data.results || []).map(m => ({
            ...m,
            preview: m.content,
            msgType: m.type,
          }));
          setMessages(msgs);
        })
        .catch(() => setMessages([]))
        .finally(() => setSearchingMsg(false));
    }, 300);
    return () => clearTimeout(timer);
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
      {/* 联系人 */}
      {matchedContacts.length > 0 && (
        <>
          <div className="gs-cat">联系人</div>
          {matchedContacts.map(c => (
            <div key={c.id} className="gs-row" onClick={() => openContact(c)}
              role="button" tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && openContact(c)}>
              <Avatar src={c.avatar} name={c.remark || c.username} size={42} />
              <div className="gs-info">
                <div className="gs-name">{highlight(c.remark || c.username, q)}</div>
                {c.remark && c.username && c.username.toLowerCase().includes(q) && (
                  <div className="gs-sub">昵称：{highlight(c.username, q)}</div>
                )}
                {c.wechat_id && c.wechat_id.toLowerCase().includes(q) && (
                  <div className="gs-sub">微信号：{highlight(c.wechat_id, q)}</div>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {/* 会话(群聊、文件传输助手等) */}
      {matchedConversations.length > 0 && (
        <>
          <div className="gs-cat">{matchedConversations.some(c => c.type === 'filehelper') ? '特殊会话' : '群聊'}</div>
          {matchedConversations.map(g => (
            <div key={g.id} className="gs-row" onClick={() => openConversation(g)}
              role="button" tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && openConversation(g)}>
              {g.type === 'filehelper' ? (
                <div className="gs-filehelper-icon">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
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
              onKeyDown={e => e.key === 'Enter' && openMessageLocation(m)}>
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

      {/* 降级兜底 */}
      {empty && !searchingMsg && (
        <div
          onClick={() => onNetworkSearch(query)}
          className="gs-network-row"
          role="button" tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && onNetworkSearch(query)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="var(--green)" className="gs-network-icon"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
          <span>未找到相关本地结果，去网络搜索添加<span className="gs-highlight">「{query}」</span></span>
        </div>
      )}
    </div>
  );
}
