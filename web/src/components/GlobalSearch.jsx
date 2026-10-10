import TouliaoIcon, { iconForMessageType } from '../ui-kit/Icon';
import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import { EmptyState, ErrorState } from './StateViews';
import { TextButton } from '../ui-kit/Button';
import { GroupAvatar } from './GroupAvatar';
import { useI18n } from '../contexts/I18nContext';
import { startSearchTask } from '../utils/searchTask';
import {
  buildMessageSearchParams,
  formatSearchMessageSummary,

  MESSAGE_SEARCH_TYPES,
} from '../utils/messageSearchFilters';

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
  const { t } = useI18n();
  const [contacts, setContacts] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [messageSearch, setMessageSearch] = useState({ status: 'idle', data: [] });
  const [lookupLoading, setLookupLoading] = useState(true);
  const [contactError, setContactError] = useState(null);
  const [convError, setConvError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [timeRange, setTimeRange] = useState('');
  const [senderId, setSenderId] = useState('');
  const [senderOptions, setSenderOptions] = useState([]);
  const q = query.trim().toLowerCase();
  const hasQuery = !!q;
  const searchKey = JSON.stringify([q, typeFilter, timeRange, senderId]);

  // Fetch lookups once on entry, or on retry; typing uses local filtering.
  useEffect(() => {
    if (!hasQuery) return;
    const ac = new AbortController();
    const contactsRequest = axios.get('/api/users/contacts', { signal: ac.signal })
      .then(r => {
        if (ac.signal.aborted) return;
        setContacts(Array.isArray(r.data) ? r.data : []);
        setContactError(null);
      })
      .catch(() => { if (!ac.signal.aborted) setContactError(t('convSearch.failed')); });
    const conversationsRequest = axios.get('/api/messages/conversations', { signal: ac.signal })
      .then(r => {
        if (ac.signal.aborted) return;
        setConversations(Array.isArray(r.data) ? r.data : []);
        setConvError(null);
      })
      .catch(err => {
        if (!ac.signal.aborted) setConvError(t(err.response?.status === 401 ? 'gs.authFailedRelogin' : 'convSearch.failed'));
      });
    Promise.allSettled([contactsRequest, conversationsRequest]).then(() => {
      if (!ac.signal.aborted) setLookupLoading(false);
    });
    return () => ac.abort();
  }, [hasQuery, t, retry]);

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
    const fileHelperName = t('contacts.fileHelper');
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
  }, [conversations, q, t]);

  // The query and filters identify a result set, including while debouncing.
  useEffect(() => startSearchTask({
    key: searchKey, query: q, delay: 300,
    load: async (_query, signal) => {
      const params = buildMessageSearchParams({ query: q, type: typeFilter, timeRange, senderId });
      const { data } = await axios.get('/api/messages/search', { params, signal });
      return data?.results;
    },
    onState: next => {
      setMessageSearch(next);
      if (next.status === 'success') setSenderOptions(previous => {
        const byId = new Map(previous.map(sender => [String(sender.id), sender]));
        next.data.forEach(message => {
          if (message.sender_id) byId.set(String(message.sender_id), { id: String(message.sender_id), name: message.senderName || '' });
        });
        return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
      });
    },
  }), [q, typeFilter, timeRange, senderId, retry, searchKey]);

  const openContact = async (c) => {
    try {
      const { data } = await axios.post('/api/messages/conversation/private', { userId: c.id });
      onSelectConv({ id: data.conversationId, type: 'private', name: c.remark || c.username, avatar: c.avatar, otherUser: c });
    } catch { /* open-conversation failed; ignore */ }
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

  // 空关键词时忽略上一次搜索的残留（不在 effect 内清空，改由此处派生）
  const currentSearch = messageSearch.key === searchKey;
  const msgResults = hasQuery && currentSearch ? messageSearch.data : [];
  const actualSearching = hasQuery && (lookupLoading || !currentSearch || messageSearch.status === 'loading');
  const messageError = currentSearch && messageSearch.status === 'error' ? t('convSearch.failed') : null;
  const empty = matchedContacts.length === 0 && matchedConversations.length === 0 && msgResults.length === 0;

  return (
    <div className="gs-scroll">
      {/* 会话加载失败提示（此前静默吞掉，导致会话搜索结果为空却无任何反馈） */}
      {hasQuery && (contactError || convError || messageError) && (
        <ErrorState desc={contactError || convError || messageError} onRetry={() => {
          setLookupLoading(true);
          setContactError(null);
          setConvError(null);
          setRetry(value => value + 1);
        }} />
      )}
      {/* 联系人 */}
      {matchedContacts.length > 0 && (
        <>
          <div className="gs-cat">{t('gs.contactsCategory')}</div>
          {matchedContacts.map(c => (
            <div key={c.id} className="gs-row" onClick={() => openContact(c)}
              role="button" tabIndex={0}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openContact(c))}>
              <Avatar src={c.avatar} name={c.remark || c.username} size='md' />
              <div className="gs-info">
                <div className="gs-name">{highlight(c.remark || c.username, q)}</div>
                {c.remark && c.username && c.username.toLowerCase().includes(q) && (
                  <div className="gs-sub">{t('gs.nicknameLabel')}{highlight(c.username, q)}</div>
                )}
                {c.wechat_id && c.wechat_id.toLowerCase().includes(q) && (
                  <div className="gs-sub">{t('gs.touliaoIdLabel')}{highlight(c.wechat_id, q)}</div>
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
            {matchedConversations.every(c => c.type === 'filehelper') ? t('contacts.fileHelper')
              : matchedConversations.every(c => c.type === 'group') ? t('gs.groupsCategory')
              : t('gs.conversationsCategory')}
          </div>
          {matchedConversations.map(g => (
            <div key={g.id} className="gs-row" onClick={() => openConversation(g)}
              role="button" tabIndex={0}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openConversation(g))}>
              {g.type === 'filehelper' ? (
                <div className="gs-filehelper-icon">
                  <TouliaoIcon name="fileContent" tone="onDark" size="sm" />
                </div>
              ) : (
                <GroupAvatar members={g.members || []} avatar={g.avatar} size='md' />
              )}
              <div className="gs-info">
                <div className="gs-name">{highlight(g.name, q)}</div>
                {g.group_number && <div className="gs-sub">{t('gs.groupNumberTemplate').replace('{number}', g.group_number)}</div>}
              </div>
            </div>
          ))}
        </>
      )}

      {/* 历史消息 */}
      {hasQuery && (
        <div className="gs-filters" role="group" aria-label={t('gs.filters')}>
          <label className="gs-type-filter">
            <span>{t('gs.typeFilter')}</span>
            <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)}>
              {MESSAGE_SEARCH_TYPES.map(option => (
                <option key={option.value || 'all'} value={option.value}>{t(option.labelKey)}</option>
              ))}
            </select>
          </label>
          <div className="gs-time-filter" role="group" aria-label={t('gs.timeFilter')}>
            {[
              ['', 'gs.timeAny'],
              ['today', 'gs.timeToday'],
              ['7d', 'gs.time7Days'],
              ['30d', 'gs.time30Days'],
            ].map(([value, key]) => (
              <button key={value || 'any'} type="button" className={timeRange === value ? 'active' : ''}
                aria-pressed={timeRange === value} onClick={() => setTimeRange(value)}>{t(key)}</button>
            ))}
          </div>
          {senderOptions.length > 0 && (
            <label className="gs-sender-filter">
              <span>{t('gs.senderFilter')}</span>
              <select value={senderId} onChange={event => setSenderId(event.target.value)}>
                <option value="">{t('gs.allSenders')}</option>
                {senderOptions.map(sender => <option key={sender.id} value={sender.id}>{sender.name || t('chatlist.unknown')}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {msgResults.length > 0 && (
        <>
          <div className="gs-cat">{t('gs.chatHistoryCategoryTemplate').replace('{count}', msgResults.length)}</div>
          {msgResults.map(m => (
            <div key={m.id} className="gs-row" onClick={() => openMessageLocation(m)}
              role="button" tabIndex={0}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openMessageLocation(m))}>
              <Avatar src={m.senderAvatar} name={m.senderName} size='md' />
              <div className="gs-info">
                <div className="gs-msg-meta">
                  {m.senderName} {m.convType === 'group' ? t('gs.inGroupTemplate').replace('{name}', m.convName) : ''}
                </div>
                <div className="gs-msg-text">
                  <span className="gs-msg-type-icon" aria-hidden="true"><TouliaoIcon name={iconForMessageType(m.type)} size="xs" /></span>
                  {highlight(formatSearchMessageSummary(m, t), q)}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {actualSearching && (
        <div role="status" className="gs-searching">{t('convSearch.searching')}</div>
      )}

      {/* 降级兜底：仅在有实际查询词时展示,避免清空输入时闪出「去网络搜索『』」空串 */}
      {empty && !actualSearching && !contactError && !convError && !messageError && q && (
        <EmptyState illustration="search" title={t('gs.noLocalResultsPrefix')} action={
          <TextButton className="gs-network-row" onClick={() => onNetworkSearch(query)}>
            <TouliaoIcon name="search" className="gs-network-icon" tone="selected" size="xs" />
            <span className="gs-highlight">「{query}」</span>
          </TextButton>
        } />
      )}
    </div>
  );
}
