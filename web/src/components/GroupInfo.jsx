import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { FixedSizeList } from 'react-window';
import Avatar, { getColor } from './Avatar';
import { mediaUrl } from '../utils/url';
import { showToast, showConfirm } from '../utils/toast';

/* ── 宫格单元：头像加载失败回退首字母，避免碎图 ── */
function GroupGridCell({ member = {}, cellSize }) {
  const [err, setErr] = useState(false);
  useEffect(() => { setErr(false); }, [member.avatar]);
  return (
    <div style={{ width: cellSize, height: cellSize, borderRadius: 2, overflow: 'hidden', background: getColor(member.username || '?'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {member.avatar && !err
        ? <img loading="lazy" src={mediaUrl(member.avatar)} alt="" className="gi-avatar-img" onError={() => setErr(true)} />
        : <span style={{ fontSize: cellSize * 0.45, fontWeight: 600, color: 'var(--text-inverse)' }}>{(member.username || '?')[0]}</span>}
    </div>
  );
}

/* ── 群头像拼图（微信风格 N宫格，支持自定义头像） ── */
export function GroupAvatar({ members = [], size = 46, avatar = '' }) {
  const [avatarErr, setAvatarErr] = useState(false);
  useEffect(() => { setAvatarErr(false); }, [avatar]);
  // 有自定义群头像直接显示；加载失败则回退到下面的宫格拼图
  if (avatar && !avatarErr) {
    return <img src={mediaUrl(avatar)} alt="" loading="lazy" onError={() => setAvatarErr(true)} style={{ width: size, height: size, borderRadius: Math.max(3, Math.round(size * 0.13)), objectFit: 'cover', flexShrink: 0 }} />;
  }
  const n = Math.min(members.length, 9);
  if (n === 0) return <Avatar name="群" size={size} />;
  if (n === 1) return <Avatar src={members[0].avatar} name={members[0].username} size={size} />;
  const grid = n <= 4 ? 2 : 3;
  const cellSize = Math.floor((size - (grid + 1) * 2) / grid);
  return (
    <div style={{ width: size, height: size, borderRadius: Math.max(3, Math.round(size * 0.13)), background: 'var(--bg-app)', display: 'grid', overflow: 'hidden', gridTemplateColumns: `repeat(${grid}, ${cellSize}px)`, gap: 2, padding: 2, flexShrink: 0 }}>
      {members.slice(0, grid * grid).map((m, i) => (
        <GroupGridCell key={i} member={m} cellSize={cellSize} />
      ))}
    </div>
  );
}

/* ── 群头像上传（管理员 hover 显示相机图标） ── */
function GroupAvatarUpload({ info, isAdmin, uploading, inputRef, onAvatarClick, onChange }) {
  const [hovered, setHovered] = useState(false);
  const [avErr, setAvErr] = useState(false);
  useEffect(() => { setAvErr(false); }, [info.avatar]);
  const r = Math.round(50 * 0.22);
  return (
    <div
      className="gi-av-wrap" style={{ cursor: isAdmin ? 'pointer' : 'default' }}
      onMouseEnter={() => isAdmin && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onAvatarClick}
      title={isAdmin ? '点击更换群头像' : undefined}
    >
      {info.avatar && !avErr
        ? <img src={mediaUrl(info.avatar)} alt="" loading="lazy" className="gi-av-img" onError={() => setAvErr(true)} style={{ borderRadius: r }} />
        : <GroupAvatar members={info.members} size={50} />
      }
      {isAdmin && (hovered || uploading) && (
        <div className="gi-av-overlay" style={{ borderRadius: r }}>
          {uploading
            ? <span className="gi-av-uploading">上传中…</span>
            : <>
                <svg viewBox="0 0 24 24" className="gi-av-icon">
                  <path d="M12 15.2A3.2 3.2 0 0 1 8.8 12 3.2 3.2 0 0 1 12 8.8a3.2 3.2 0 0 1 3.2 3.2 3.2 3.2 0 0 1-3.2 3.2M20 4h-3.17L15 2H9L7.17 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/>
                </svg>
                <span className="gi-av-hint">更换头像</span>
              </>
          }
        </div>
      )}
      {isAdmin && (
        <input ref={inputRef} type="file" accept="image/*" className="gi-av-input" onChange={onChange} />
      )}
    </div>
  );
}

/* ── 微信风格 Toggle 开关 ── */
function Toggle({ on, onChange, disabled }) {
  return (
    <div
      onClick={() => !disabled && onChange(!on)}
      className="gi-toggle"
      style={{ background: on ? 'var(--green)' : 'var(--border-default)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}
    >
      <div className="gi-toggle-thumb" style={{ left: on ? 21 : 3 }} />
    </div>
  );
}

/* ── 角色标签 ── */
function RoleBadge({ role }) {
  if (role === 'owner') return <span className="gi-badge gi-badge-owner">群主</span>;
  if (role === 'admin') return <span className="gi-badge gi-badge-admin">管理员</span>;
  return null;
}

/* ── 成员行（提升到组件外以保证 react-window 引用稳定）── */
const GroupMemberRow = React.memo(function GroupMemberRow({ index, style, data }) {
  const { filtered, kickSearch, isOwner, isAdmin, currentUserId, toggleAdmin, transferOwner, kickMember } = data;
  const m = filtered[index];
  const q = kickSearch.toLowerCase();
  return (
    <div className="gi-mi" style={style}>
      <Avatar src={m.avatar} name={m.username} size={38} />
      <div className="gi-f1">
        <div className="gi-mn">
          {kickSearch && m.username.toLowerCase().includes(q)
            ? (() => {
                const idx = m.username.toLowerCase().indexOf(q);
                return (
                  <>
                    {m.username.slice(0, idx)}
                    <span className="gi-search-hl">{m.username.slice(idx, idx + kickSearch.length)}</span>
                    {m.username.slice(idx + kickSearch.length)}
                  </>
                );
              })()
            : m.username
          }
          <RoleBadge role={m.role} />
        </div>
      </div>
      {isOwner && m.role !== 'owner' && (
        <button
          className="gi-btn-admin"
          style={{ color: m.role === 'admin' ? 'var(--text-tertiary)' : 'var(--green)', border: `1px solid ${m.role === 'admin' ? 'var(--border-default)' : 'var(--green)'}` }}
          onClick={() => toggleAdmin(m.id, m.role)}
        >{m.role === 'admin' ? '撤销管理员' : '设为管理员'}</button>
      )}
      {isOwner && m.role !== 'owner' && (
        <button
          className="gi-btn-admin"
          style={{ color: 'var(--green)', border: '1px solid var(--green)' }}
          onClick={() => transferOwner(m.id)}
        >转让群主</button>
      )}
      {isAdmin && m.id !== currentUserId && m.role === 'member' && (
        <button className="gi-btn-kick" onClick={() => kickMember(m.id)}>移出</button>
      )}
    </div>
  );
});

/* ── 主组件 ── */
export default function GroupInfo({ conversation, currentUserId, onClose, onLeave, onConvUpdate, onPickBackground, onClearBackground, onCleared }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editName, setEditName] = useState(false);
  const [editAnn, setEditAnn] = useState(false);
  const [nameVal, setNameVal] = useState('');
  const [annVal, setAnnVal] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [myContacts, setMyContacts] = useState([]);
  const [selectedInvite, setSelectedInvite] = useState(new Set());
  const [togglingMute, setTogglingMute] = useState(false);
  const [togglingNoPrivate, setTogglingNoPrivate] = useState(false);
  const [togglingNoAddFriend, setTogglingNoAddFriend] = useState(false);
  // 个人会话设置
  const [myMuted, setMyMuted] = useState(!!conversation.muted);
  const [myPinned, setMyPinned] = useState(!!conversation.pinned);
  const [togglingMyMute, setTogglingMyMute] = useState(false);
  const [togglingMyPin, setTogglingMyPin] = useState(false);
  // 踢人搜索
  const [kickSearch, setKickSearch] = useState('');
  // 群头像上传
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef(null);
  // 群昵称
  const [editNickname, setEditNickname] = useState(false);
  const [nicknameVal, setNicknameVal] = useState('');
  const [myNickname, setMyNickname] = useState(null);
  // 群二维码
  const [showQR, setShowQR] = useState(false);
  const [qrData, setQrData] = useState(null);

  const load = () => {
    setLoading(true);
    axios.get(`/api/messages/conversation/${conversation.id}/info`).then(r => {
      setInfo(r.data);
      setNameVal(r.data.name || '');
      setAnnVal(r.data.announcement || '');
      // 找到自己的群昵称
      const me = (r.data.members || []).find(m => m.id === currentUserId);
      if (me?.nickname) { setMyNickname(me.nickname); setNicknameVal(me.nickname); }
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [conversation.id]);

  const myRole = info?.myRole || 'member';
  const isOwner = myRole === 'owner';
  const isAdmin = myRole === 'admin' || isOwner;
  const isManageable = isAdmin; // 群主和管理员都可以看到群管理

  /* 保存群昵称 */
  const saveNickname = async () => {
    try {
      await axios.put(`/api/messages/conversation/${conversation.id}/nickname`, { nickname: nicknameVal.trim() || null });
      setMyNickname(nicknameVal.trim() || null);
      setEditNickname(false);
    } catch (e) { showToast(e.response?.data?.error || '修改失败', 'error'); }
  };

  /* 加载群二维码 */
  const loadQR = async () => {
    setShowQR(true);
    if (qrData) return;
    try {
      const { data } = await axios.get(`/api/messages/conversation/${conversation.id}/qr-code`);
      setQrData(data);
    } catch { setQrData(null); }
  };

  /* 修改群名 */
  const saveName = async () => {
    if (!nameVal.trim()) return;
    await axios.put(`/api/messages/conversation/${conversation.id}`, { name: nameVal.trim() });
    setInfo(i => ({ ...i, name: nameVal.trim() }));
    setEditName(false);
    onConvUpdate?.({ name: nameVal.trim() });
  };

  /* 修改群公告 */
  const saveAnn = async () => {
    await axios.put(`/api/messages/conversation/${conversation.id}`, { announcement: annVal });
    setInfo(i => ({ ...i, announcement: annVal }));
    setEditAnn(false);
  };

  /* 切换全群禁言 */
  const toggleMuteAll = async (val) => {
    setTogglingMute(true);
    try {
      const { data } = await axios.put(`/api/messages/conversation/${conversation.id}/manage`, { mute_all: val });
      setInfo(i => ({ ...i, mute_all: data.mute_all }));
      onConvUpdate?.({ mute_all: data.mute_all });
    } catch (e) { showToast(e.response?.data?.error || '操作失败', 'error'); }
    setTogglingMute(false);
  };

  /* 切换禁止私聊 */
  const toggleNoPrivateChat = async (val) => {
    setTogglingNoPrivate(true);
    try {
      const { data } = await axios.put(`/api/messages/conversation/${conversation.id}/manage`, { no_private_chat: val });
      setInfo(i => ({ ...i, no_private_chat: data.no_private_chat }));
      onConvUpdate?.({ no_private_chat: data.no_private_chat });
    } catch (e) { showToast(e.response?.data?.error || '操作失败', 'error'); }
    setTogglingNoPrivate(false);
  };

  /* 切换禁止互加好友 */
  const toggleNoAddFriend = async (val) => {
    setTogglingNoAddFriend(true);
    try {
      const { data } = await axios.put(`/api/messages/conversation/${conversation.id}/manage`, { no_add_friend: val });
      setInfo(i => ({ ...i, no_add_friend: data.no_add_friend }));
      onConvUpdate?.({ no_add_friend: data.no_add_friend });
    } catch (e) { showToast(e.response?.data?.error || '操作失败', 'error'); }
    setTogglingNoAddFriend(false);
  };

  /* 设置/取消管理员（仅群主） */
  const toggleAdmin = async (uid, currentRole) => {
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    const name = info.members.find(m => m.id === uid)?.username || '未知用户';
    const action = newRole === 'admin' ? `设置「${name}」为管理员` : `撤销「${name}」的管理员`;
    if (!(await showConfirm(action + '？'))) return;
    await axios.put(`/api/messages/conversation/${conversation.id}/members/${uid}/role`, { role: newRole });
    setInfo(i => ({ ...i, members: i.members.map(m => m.id === uid ? { ...m, role: newRole } : m) }));
  };

  /* 转让群主（仅群主） */
  const transferOwner = async (uid) => {
    const name = info.members.find(m => m.id === uid)?.username || '未知用户';
    if (!(await showConfirm(`确认将群主转让给「${name}」？转让后你将成为普通成员。`))) return;
    await axios.post(`/api/messages/conversation/${conversation.id}/transfer-owner`, { userId: uid });
    setInfo(i => ({
      ...i,
      owner_id: uid,
      myRole: 'member',
      members: i.members.map(m =>
        m.id === uid ? { ...m, role: 'owner' } : (m.role === 'owner' ? { ...m, role: 'member' } : m)
      ),
    }));
  };

  /* 移出成员 */
  const kickMember = async (uid) => {
    const name = info.members.find(m => m.id === uid)?.username || '未知用户';
    if (!(await showConfirm(`确认移出成员「${name}」？`))) return;
    await axios.delete(`/api/messages/conversation/${conversation.id}/members/${uid}`);
    setInfo(i => ({ ...i, members: i.members.filter(m => m.id !== uid) }));
  };

  /* 邀请成员 */
  const openInvite = async () => {
    const { data } = await axios.get('/api/users/contacts');
    const alreadyIn = new Set(info.members.map(m => m.id));
    setMyContacts(data.filter(c => !alreadyIn.has(c.id)));
    setSelectedInvite(new Set());
    setShowInvite(true);
  };
  const doInvite = async () => {
    if (selectedInvite.size === 0) return;
    await axios.post(`/api/messages/conversation/${conversation.id}/invite`, { userIds: [...selectedInvite] });
    setShowInvite(false);
    load();
  };

  /* 退出群聊（非群主）*/
  const leaveGroup = async () => {
    if (!(await showConfirm('确认退出群聊？'))) return;
    await axios.post(`/api/messages/conversation/${conversation.id}/leave`);
    onLeave?.();
  };

  /* 解散群聊（仅群主）*/
  const dissolveGroup = async () => {
    if (!(await showConfirm('解散群聊后所有成员将无法继续聊天，确认解散？'))) return;
    await axios.post(`/api/messages/conversation/${conversation.id}/dissolve`);
    onLeave?.();
  };

  const clearMessages = async () => {
    if (!(await showConfirm(`确认双向删除「${info?.name || conversation.name || '该群聊'}」的全部聊天记录？所有群成员都将看不到这些记录。`))) return;
    await axios.delete(`/api/messages/conversation/${conversation.id}/messages`);
    onCleared?.();
  };

  /* 修改群头像 */
  const uploadAvatar = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!ALLOWED_TYPES.includes(file.type)) {
      showToast('仅支持 JPG、PNG、GIF、WebP 格式', 'error');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('图片大小不能超过 5MB', 'error');
      e.target.value = '';
      return;
    }
    setUploadingAvatar(true);
    try {
      const fd = new FormData();
      fd.append('avatar', file);
      const { data } = await axios.put(
        `/api/messages/conversation/${conversation.id}/avatar`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setInfo(i => ({ ...i, avatar: data.avatar }));
      onConvUpdate?.({ avatar: data.avatar });
    } catch (err) {
      showToast(err.response?.data?.error || '上传失败', 'error');
    }
    setUploadingAvatar(false);
    e.target.value = '';
  };

  if (loading) return (
    <div className="gi-panel gi-fcd gi-ccc">
      <div className="gi-fcd gi-fca gi-gap8">
        <div className="gi-spinner gi-spinner-green" />
        <span className="gi-loading-txt">加载中…</span>
      </div>
    </div>
  );
  if (!info) return null;

  return (
    <div className="gi-panel">
      {/* 顶部栏 */}
      <div className="gi-header">
        <span className="gi-title">群聊信息</span>
        <button
          className="gi-close-btn"
          onClick={onClose}
          aria-label="关闭群聊信息"
        >✕</button>
      </div>

      <div className="gi-body">

        {/* 群名称 + 头像 */}
        <div className="gi-avinfo">
          <GroupAvatarUpload
            info={info}
            isAdmin={isAdmin}
            uploading={uploadingAvatar}
            inputRef={avatarInputRef}
            onAvatarClick={() => isAdmin && !uploadingAvatar && avatarInputRef.current?.click()}
            onChange={uploadAvatar}
          />
          <div className="gi-f1">
            {editName ? (
              <div className="gi-fca gi-gap6">
                <input value={nameVal} onChange={e => setNameVal(e.target.value)}
                  className="gi-name-edit" data-testid="group-rename-input"
                  autoFocus onKeyDown={e => e.key === 'Enter' && saveName()} />
                <button className="gi-btn-edit" data-testid="group-rename-save" onClick={saveName}>保存</button>
                <button className="gi-btn-xl" onClick={() => setEditName(false)}>取消</button>
              </div>
            ) : (
              <div className="gi-name-row">
                <span className="gi-name">{info.name}</span>
                {isAdmin && <button className="gi-btn-name" onClick={() => setEditName(true)}>✎</button>}
              </div>
            )}
            <div className="gi-meta">
              {info.members.length} 位成员
              {info.group_number && <span className="gi-ml8">群号：{info.group_number}</span>}
            </div>
          </div>
        </div>

        {/* 群公告 */}
        <div className="gi-section gi-section-pad">
          <div className="gi-fcsb" style={{ marginBottom: editAnn ? 8 : 6 }}>
            <div className="gi-fca gi-gap5">
              <svg viewBox="0 0 24 24" className="gi-s14 gi-fill-warn">
                <path d="M18 11v2H6v-2h12zm-6-7L6.35 7H4v10h2.35L12 20l5.65-3H20V7h-2.35L12 4zm4 13.02l-4 2.26-4-2.26V9h8v8.02z"/>
              </svg>
              <span className="gi-sec-tit">群公告</span>
            </div>
            {isAdmin && !editAnn && (
              <button className="gi-btn-edit" onClick={() => setEditAnn(true)}>编辑</button>
            )}
          </div>
          {editAnn ? (
            <>
              <textarea value={annVal} onChange={e => setAnnVal(e.target.value)}
                className="gi-ann-textarea"
                autoFocus placeholder="填写群公告…" />
              <div className="gi-ann-bar">
                <button className="gi-btn-cancel" onClick={() => setEditAnn(false)}>取消</button>
                <button className="gi-btn-save" onClick={saveAnn}>保存</button>
              </div>
            </>
          ) : (
            <div className={info.announcement ? 'gi-t13 gi-ann-preview' : 'gi-t13m gi-ann-preview'}>
              {info.announcement || '暂无群公告，点击"编辑"添加'}
            </div>
          )}
        </div>

        {/* ── 群管理（群主和管理员可见，钉钉对标设计） ── */}
        {isManageable && (
          <div className="gi-section">
            <div
              className="gi-row gi-mg-click"
              onClick={() => setShowManage(v => !v)}
            >
              <div className="gi-ic30 gi-ic-mg-header">
                <svg viewBox="0 0 24 24" className="gi-s16 gi-fill-white">
                  <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 4l5 2.18V11c0 3.5-2.33 6.79-5 7.93-2.67-1.14-5-4.43-5-7.93V7.18L12 5z"/>
                </svg>
              </div>
              <div className="gi-f1">
                <span className="gi-text14 gi-fw5">群管理</span>
                {(info.mute_all || info.no_private_chat || info.no_add_friend) && (
                  <div className="gi-mg-active">
                    {[info.mute_all && '全员禁言', info.no_private_chat && '禁止私聊', info.no_add_friend && '禁止互加好友'].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
              <svg viewBox="0 0 24 24" className="gi-s14 gi-fill-grey" style={{ transform: showManage ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
              </svg>
            </div>

            {showManage && (
              <div className="gi-mg-bg">
                {/* 全员禁言 */}
                <div className="gi-mg-row">
                  <div className="gi-ic28 gi-ic-mg1">
                    <svg viewBox="0 0 24 24" className="gi-s14 gi-fill-warn"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
                  </div>
                  <div className="gi-f1">
                    <div className="gi-mg-label">全员禁言</div>
                    <div className="gi-mg-desc">开启后，只有群主和管理员可以发消息</div>
                  </div>
                  <Toggle on={!!info.mute_all} onChange={toggleMuteAll} disabled={togglingMute} />
                </div>

                {/* 禁止私聊 */}
                <div className="gi-mg-row">
                  <div className="gi-ic28 gi-ic-mg2">
                    <svg viewBox="0 0 24 24" className="gi-s14 gi-fill-green"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
                  </div>
                  <div className="gi-f1">
                    <div className="gi-mg-label">禁止私聊</div>
                    <div className="gi-mg-desc">开启后，普通成员无法与群成员私信</div>
                  </div>
                  <Toggle on={!!info.no_private_chat} onChange={toggleNoPrivateChat} disabled={togglingNoPrivate} />
                </div>

                {/* 禁止群成员互相添加好友 */}
                <div className="gi-mg-row-last">
                  <div className="gi-ic28 gi-ic-mg3">
                    <svg viewBox="0 0 24 24" className="gi-s14 gi-fill-red"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                  </div>
                  <div className="gi-f1">
                    <div className="gi-mg-label">禁止群成员互相添加好友</div>
                    <div className="gi-mg-desc">开启后，群成员不可通过本群互加好友</div>
                  </div>
                  <Toggle on={!!info.no_add_friend} onChange={toggleNoAddFriend} disabled={togglingNoAddFriend} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* 状态提示条（非管理员时展示当前限制） */}
        {!isAdmin && (info.mute_all || info.no_private_chat || info.no_add_friend) && (
          <div className="gi-warn">
            {info.mute_all && (
              <div className="gi-warn-row">
                <svg viewBox="0 0 24 24" className="gi-s12 gi-warn-icon"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
                全员禁言已开启，您当前无法发送消息
              </div>
            )}
            {info.no_private_chat && (
              <div className="gi-warn-row">
                <svg viewBox="0 0 24 24" className="gi-s12 gi-warn-icon"><path d="M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1zm-1 5h2v6h-2zm0 8h2v2h-2z"/></svg>
                禁止私聊已开启，您无法与群成员私信
              </div>
            )}
            {info.no_add_friend && (
              <div className="gi-warn-row">
                <svg viewBox="0 0 24 24" className="gi-s12 gi-warn-icon"><path d="M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1zm-1 5h2v6h-2zm0 8h2v2h-2z"/></svg>
                禁止互加好友已开启，不可通过本群添加群成员为好友
              </div>
            )}
          </div>
        )}

        {/* 群成员列表 */}
        <div className="gi-section">
          {/* 标题行 + 搜索框 */}
          <div className="gi-ml-head">
            <div className="gi-fcsb gi-ml-last">
              <span className="gi-grp-tit">
                群成员 ({info.members.length})
              </span>
            </div>
            {/* 仅管理员显示搜索框（用于快速找人踢出） */}
            {isAdmin && (
              <div className="gi-ml-search">
                <svg viewBox="0 0 24 24" className="gi-s13 gi-search-icon">
                  <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
                <input
                  value={kickSearch}
                  onChange={e => setKickSearch(e.target.value)}
                  placeholder="搜索成员…"
                  className="gi-ml-si"
                />
                {kickSearch && (
                  <button className="gi-clear-search" onClick={() => setKickSearch('')} aria-label="清空搜索">✕</button>
                )}
              </div>
            )}
          </div>

          <div className="gi-ml-body">
            {/* 邀请按钮（搜索时隐藏） */}
            {!kickSearch && (
              <div className="gi-inv-row" onClick={openInvite}>
                <div className="gi-inv-box">+</div>
                <span className="gi-inv-txt">邀请成员</span>
              </div>
            )}

            {/* 成员列表（支持搜索过滤；>50 人时虚拟化渲染） */}
            {(() => {
              const q = kickSearch.toLowerCase();
              const filtered = kickSearch
                ? info.members.filter(m => m.username.toLowerCase().includes(q))
                : info.members;
              if (kickSearch && filtered.length === 0) {
                return <div className="gi-no-match">未找到匹配成员</div>;
              }
              const itemData = { filtered, kickSearch, isOwner, isAdmin, currentUserId, toggleAdmin, transferOwner, kickMember };
              if (filtered.length > 50) {
                return (
                  <FixedSizeList
                    height={Math.min(filtered.length * 52, 400)}
                    itemCount={filtered.length}
                    itemSize={52}
                    width="100%"
                    itemData={itemData}
                  >
                    {GroupMemberRow}
                  </FixedSizeList>
                );
              }
              return filtered.map((m, index) => (
                <GroupMemberRow key={m.id} index={index} style={{}} data={itemData} />
              ));
            })()}
          </div>
        </div>

        {/* 个人设置 */}
        <div className="gi-section">
          <div className="gi-row">
            <span className="gi-label">消息免打扰</span>
            <Toggle
              on={myMuted}
              disabled={togglingMyMute}
              onChange={async (val) => {
                setTogglingMyMute(true);
                try {
                  await axios.post(`/api/messages/conversation/${conversation.id}/mute`, { muted: val ? 1 : 0 });
                  setMyMuted(val);
                  onConvUpdate?.({ muted: val ? 1 : 0 });
                } catch { showToast('操作失败', 'error'); }
                setTogglingMyMute(false);
              }}
            />
          </div>
          <div className="gi-row">
            <span className="gi-label">置顶聊天</span>
            <Toggle
              on={myPinned}
              disabled={togglingMyPin}
              onChange={async (val) => {
                setTogglingMyPin(true);
                try {
                  await axios.post(`/api/messages/conversation/${conversation.id}/pin`, { pinned: val ? 1 : 0 });
                  setMyPinned(val);
                  onConvUpdate?.({ pinned: val ? 1 : 0 });
                } catch { showToast('操作失败', 'error'); }
                setTogglingMyPin(false);
              }}
            />
          </div>
          <div className={`gi-row${conversation.background ? '' : ' gi-row-noborder'}`} style={{ cursor: 'pointer' }} onClick={() => onPickBackground?.()}>
            <span className="gi-label">设置聊天背景</span>
            <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>{conversation.background ? '更换 ›' : '选择图片 ›'}</span>
          </div>
          {conversation.background && (
            <div className="gi-row gi-row-noborder" style={{ cursor: 'pointer' }} onClick={() => onClearBackground?.()}>
              <span className="gi-label" style={{ color: 'var(--color-badge)' }}>清除聊天背景</span>
            </div>
          )}
        </div>

        {/* 群昵称 */}
        <div className="gi-nk">
          <div className="gi-nk-hd">我在本群的昵称</div>
          <div className="gi-nk-bd">
            {editNickname ? (
              <>
                <input
                  autoFocus
                  value={nicknameVal}
                  onChange={e => setNicknameVal(e.target.value)}
                  placeholder="设置群昵称（最多30字）"
                  maxLength={30}
                  className="gi-nick-input"
                  onKeyDown={e => { if (e.key === 'Enter') saveNickname(); if (e.key === 'Escape') setEditNickname(false); }}
                />
                <button className="gi-btn-save-sm" onClick={saveNickname}>保存</button>
                <button className="gi-btn-xl-sm" onClick={() => setEditNickname(false)}>取消</button>
              </>
            ) : (
              <div className="gi-f1 gi-fcsb gi-nk-cp" onClick={() => { setNicknameVal(myNickname || ''); setEditNickname(true); }}>
                <span style={{ fontSize: 14, color: myNickname ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{myNickname || '未设置'}</span>
                <svg viewBox="0 0 24 24" className="gi-s14 gi-fill-tertiary"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
              </div>
            )}
          </div>
        </div>

        {/* 群二维码 */}
        <div className="gi-qr">
          <div className="gi-qr-row" onClick={loadQR}>
            <span className="gi-text14">群二维码</span>
            <svg viewBox="0 0 24 24" className="gi-s14 gi-chevron"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
          </div>
        </div>

        {/* 操作按钮区 */}
        <div className="gi-actions">
          <button
            onClick={clearMessages}
            className="gi-btn-danger"
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-msg-other)'}
          >
            双向删除聊天记录
          </button>
          {isOwner ? (
            <button
              onClick={dissolveGroup}
              data-testid="group-dissolve-btn"
              className="gi-btn-danger"
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-msg-other)'}
            >
              解散群聊
            </button>
          ) : (
            <button
              onClick={leaveGroup}
              data-testid="group-leave-btn"
              className="gi-btn-danger"
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-msg-other)'}
            >
              退出群聊
            </button>
          )}
        </div>
      </div>

      {/* 群二维码弹窗 */}
      {showQR && (
        <div className="wc-modal-overlay" onClick={e => e.target === e.currentTarget && setShowQR(false)}>
          <div className="wc-modal gi-qr-panel">
            <div className="wc-modal-header">
              <span className="wc-modal-title">群二维码</span>
              <button className="wc-modal-close" onClick={() => setShowQR(false)} aria-label="关闭二维码">✕</button>
            </div>
            <div className="gi-qr-wrap">
              {qrData ? (
                <>
                  <img loading="lazy" src={qrData.qrCode} alt="群二维码" className="gi-qr-img" />
                  <div className="gi-qr-nm">扫码加入 {info?.name}</div>
                  <div className="gi-qr-ex">7天内有效</div>
                  <button
                    className="gi-save-btn"
                    onClick={() => {
                      const a = document.createElement('a');
                      a.href = qrData.qrCode;
                      a.download = `${info?.name || '群'}_邀请码.png`;
                      a.click();
                    }}
                  >保存图片</button>
                </>
              ) : (
                <div className="gi-qr-load">加载中…</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 邀请成员弹窗 */}
      {showInvite && (
        <div className="wc-modal-overlay" onClick={e => e.target === e.currentTarget && setShowInvite(false)}>
          <div className="wc-modal wide">
            <div className="wc-modal-header">
              <span className="wc-modal-title">邀请成员</span>
              <button className="wc-modal-close" onClick={() => setShowInvite(false)} aria-label="关闭邀请">✕</button>
            </div>
            <div className="wc-modal-body">
              <div className="gi-inv-hint">从通讯录选择（已选 {selectedInvite.size} 人）</div>
              <div className="gi-inv-list">
                {myContacts.length === 0
                  ? <div className="gi-inv-empty">所有好友已在群内</div>
                  : myContacts.map(c => (
                    <div key={c.id} className="wc-group-member-item" onClick={() => setSelectedInvite(prev => { const s = new Set(prev); s.has(c.id) ? s.delete(c.id) : s.add(c.id); return s; })}>
                      <div className={`wc-group-check${selectedInvite.has(c.id) ? ' checked' : ''}`}>{selectedInvite.has(c.id) ? '✓' : ''}</div>
                      <Avatar src={c.avatar} name={c.remark || c.username} size={36} />
                      <span className="gi-inv-name">{c.remark || c.username}</span>
                    </div>
                  ))
                }
              </div>
            </div>
            <div className="wc-modal-footer">
              <button className="wc-modal-btn secondary" onClick={() => setShowInvite(false)}>取消</button>
              <button className="wc-modal-btn primary" onClick={doInvite} disabled={selectedInvite.size === 0}>邀请 ({selectedInvite.size})</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
