import { useSocialRevision } from '../hooks/useSocialRevision';
import TouliaoField from '../ui-kit/Field';
import { PrimaryButton, SecondaryButton, DangerButton } from '../ui-kit/Button';
import TouliaoSwitch from '../ui-kit/Switch';
import TouliaoIcon from '../ui-kit/Icon';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { FixedSizeList } from 'react-window';
import Avatar from './Avatar';
import { mediaUrl, useMediaCredentials } from '../utils/url';
import { showToast, showConfirm } from '../utils/toast';
import { useConvSettings } from '../hooks/useConvSettings';
import { GroupAvatar } from './GroupAvatar';
import { useI18n } from '../contexts/I18nContext';
import { useSocket } from '../contexts/SocketContext';
import { copyToClipboard } from '../utils/clipboard';
import { IcoBack, IcoContacts, IcoPersonAdd } from './Icons';
export { GroupAvatar } from './GroupAvatar'; // re-export 向后兼容

/* ── 群头像上传（管理员 hover 显示相机图标） ── */
function GroupAvatarUpload({ info, isAdmin, uploading, inputRef, onAvatarClick, onChange }) {
  useMediaCredentials();
  const avatarUrl = mediaUrl(info.avatar);
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [avErr, setAvErr] = useState(false);
  const [prevAvatar, setPrevAvatar] = useState(avatarUrl);
  if (avatarUrl !== prevAvatar) { setPrevAvatar(avatarUrl); setAvErr(false); }
  const r = Math.round(50 * 0.22);
  return (
    <div
      className="gi-av-wrap" style={{ cursor: isAdmin ? 'pointer' : 'default' }}
      role={isAdmin ? 'button' : undefined}
      tabIndex={isAdmin ? 0 : undefined}
      aria-label={isAdmin ? t('groupInfo.changeAvatar') : undefined}
      onMouseEnter={() => isAdmin && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onAvatarClick}
      onKeyDown={isAdmin ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAvatarClick?.(); } }) : undefined}
      title={isAdmin ? t('groupInfo.clickToChangeAvatar') : undefined}
    >
      {info.avatar && !avErr
        ? <img src={avatarUrl} alt="" loading="lazy" className="gi-av-img" onError={() => setAvErr(true)} style={{ borderRadius: r }} />
        : <GroupAvatar members={info.members} size='lg' />
      }
      {isAdmin && (hovered || uploading) && (
        <div className="gi-av-overlay" style={{ borderRadius: r }}>
          {uploading
            ? <span className="gi-av-uploading">{t('groupInfo.uploading')}</span>
            : <>
                <TouliaoIcon name="group" className="gi-av-icon" size="sm" />
                <span className="gi-av-hint">{t('groupInfo.changeAvatarLabel')}</span>
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

/* ── 角色标签 ── */
function RoleBadge({ role }) {
  const { t } = useI18n();
  if (role === 'owner') return <span className="gi-badge gi-badge-owner">{t('groupInfo.roleOwner')}</span>;
  if (role === 'admin') return <span className="gi-badge gi-badge-admin">{t('groupInfo.roleAdmin')}</span>;
  return null;
}

/* ── 成员行（提升到组件外以保证 react-window 引用稳定）── */
const GroupMemberRow = React.memo(function GroupMemberRow({ index, style, data }) {
  const { t } = useI18n();
  const { filtered, kickSearch, isOwner, isAdmin, currentUserId, toggleAdmin, kickMember } = data;
  const m = filtered[index];
  const q = kickSearch.toLowerCase();
  return (
    <div className="gi-mi" style={style}>
      <Avatar src={m.avatar} name={m.username} size='md' />
      <div className="gi-f1">
        <div className="gi-mn">
          {q && (m.username || '').toLowerCase().includes(q)
            ? (() => {
                // 高亮全部命中(此前只高亮首个);用 q.length 切片,大小写混排也对齐
                const name = m.username;
                const lower = name.toLowerCase();
                const parts = [];
                let from = 0, i = lower.indexOf(q, from);
                while (i >= 0) {
                  if (i > from) parts.push(name.slice(from, i));
                  parts.push(<span key={i} className="gi-search-hl">{name.slice(i, i + q.length)}</span>);
                  from = i + q.length;
                  i = lower.indexOf(q, from);
                }
                if (from < name.length) parts.push(name.slice(from));
                return <>{parts}</>;
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
        >{m.role === 'admin' ? t('groupInfo.revokeAdmin') : t('groupInfo.makeAdmin')}</button>
      )}
      {isAdmin && m.id !== currentUserId && m.role === 'member' && (
        <button className="gi-btn-kick" onClick={() => kickMember(m.id)}>{t('groupInfo.removeMember')}</button>
      )}
    </div>
  );
});

/* ── 主组件 ── */
export default function GroupInfo({ conversation, currentUserId, onClose, onLeave, onConvUpdate, onPickBackground, onClearBackground, onCleared, onOpenChatFiles }) {
  const socialRevision = useSocialRevision();
  const { t } = useI18n();
  const { socket } = useSocket();
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
  const [togglingMemberInvite, setTogglingMemberInvite] = useState(false);
  // 个人会话设置
  // 免打扰 / 置顶：与 PrivateChatSettings 共用 useConvSettings（state + /mute /pin API）。
  // 原为 mute/pin 各自独立的 toggling 标志，现统一为单个 saving（切换期间两个开关一起禁用，
  // 防跨开关重复提交）；行为与私聊设置面板一致。
  const { muted: myMuted, pinned: myPinned, saving: savingSetting, toggleMute, togglePin } = useConvSettings(conversation, onConvUpdate);
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
  const [showTransferOwner, setShowTransferOwner] = useState(false);
  const [transferringOwner, setTransferringOwner] = useState(false);
  const [copyingInviteLink, setCopyingInviteLink] = useState(false);

  const applyInfo = useCallback((data) => {
    setInfo(data);
    setNameVal(data.name || '');
    setAnnVal(data.announcement || '');
    // 找到自己的群昵称
    const me = (data.members || []).find(m => m.id === currentUserId);
    if (me?.nickname) { setMyNickname(me.nickname); setNicknameVal(me.nickname); }
  }, [currentUserId]);

  // 重新拉取（显示转圈）——供操作后刷新
  const load = useCallback(() => {
    setLoading(true);
    axios.get(`/api/messages/conversation/${conversation.id}/info`)
      .then(r => applyInfo(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [conversation.id, applyInfo]);

  // 初次挂载 / 切换会话：loading 初值已为 true，effect 内不做同步 setState
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Invalidation must clear private projections before the replacement GET resolves.
    setInfo(null); setLoading(true);
    axios.get(`/api/messages/conversation/${conversation.id}/info`)
      .then(r => { if (alive) applyInfo(r.data); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [conversation.id, applyInfo, socialRevision]);

  useEffect(() => {
    if (!socket) return undefined;
    const refreshInfo = payload => {
      const id = payload?.conversationId || payload?.id;
      if (String(id) === String(conversation.id)) load();
    };
    socket.on('group_updated', refreshInfo);
    socket.on('role_changed', refreshInfo);
    return () => {
      socket.off('group_updated', refreshInfo);
      socket.off('role_changed', refreshInfo);
    };
  }, [socket, conversation.id, load]);

  useEffect(() => {
    const handler = e => {
      if (e.key !== 'Escape') return;
      if (showInvite) { setShowInvite(false); return; }
      if (showTransferOwner) { setShowTransferOwner(false); return; }
      if (showQR) { setShowQR(false); return; }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showInvite, showQR, showTransferOwner]);

  const myRole = info?.myRole || 'member';
  const isOwner = myRole === 'owner';
  const isAdmin = myRole === 'admin' || isOwner;
  const isManageable = isAdmin; // 群主和管理员都可以看到群管理

  /* 保存群昵称 */
  const saveNickname = async () => {
    const nick = nicknameVal.trim() || null;
    if (nick === (myNickname || null)) { setEditNickname(false); return; }  // 未改动:不发无谓请求
    try {
      await axios.put(`/api/messages/conversation/${conversation.id}/nickname`, { nickname: nick });
      setMyNickname(nick);
      setEditNickname(false);
    } catch (e) { showToast(e.response?.data?.error || t('groupInfo.saveNicknameFailed'), 'error'); }
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
    const name = nameVal.trim();
    if (!name) { showToast(t('groupInfo.nameEmpty'), 'error'); return; }   // 此前静默返回,用户不知为何没保存
    if (name === (info?.name || '')) { setEditName(false); return; }  // 未改动:直接收起,不发无谓请求
    try {
      await axios.put(`/api/messages/conversation/${conversation.id}`, { name });
      setInfo(i => ({ ...i, name }));
      setEditName(false);
      onConvUpdate?.({ name });
    } catch (e) { showToast(e.response?.data?.error || t('groupInfo.renameFailed'), 'error'); }
  };

  /* 修改群公告 */
  const saveAnn = async () => {
    if (annVal === (info?.announcement || '')) { setEditAnn(false); return; }  // 未改动:不发无谓请求
    try {
      await axios.put(`/api/messages/conversation/${conversation.id}`, { announcement: annVal });
      setInfo(i => ({ ...i, announcement: annVal }));
      setEditAnn(false);
    } catch (e) { showToast(e.response?.data?.error || t('groupInfo.announcementSaveFailed'), 'error'); }
  };

  /* 切换全群禁言 */
  const toggleMuteAll = async (val) => {
    setTogglingMute(true);
    try {
      const { data } = await axios.put(`/api/messages/conversation/${conversation.id}/manage`, { mute_all: val });
      setInfo(i => ({ ...i, mute_all: data.mute_all }));
      onConvUpdate?.({ mute_all: data.mute_all });
    } catch (e) { showToast(e.response?.data?.error || t('common.actionFailed'), 'error'); }
    setTogglingMute(false);
  };

  /* 切换禁止私聊 */
  const toggleNoPrivateChat = async (val) => {
    setTogglingNoPrivate(true);
    try {
      const { data } = await axios.put(`/api/messages/conversation/${conversation.id}/manage`, { no_private_chat: val });
      setInfo(i => ({ ...i, no_private_chat: data.no_private_chat }));
      onConvUpdate?.({ no_private_chat: data.no_private_chat });
    } catch (e) { showToast(e.response?.data?.error || t('common.actionFailed'), 'error'); }
    setTogglingNoPrivate(false);
  };

  /* 切换禁止互加好友 */
  const toggleNoAddFriend = async (val) => {
    setTogglingNoAddFriend(true);
    try {
      const { data } = await axios.put(`/api/messages/conversation/${conversation.id}/manage`, { no_add_friend: val });
      setInfo(i => ({ ...i, no_add_friend: data.no_add_friend }));
      onConvUpdate?.({ no_add_friend: data.no_add_friend });
    } catch (e) { showToast(e.response?.data?.error || t('common.actionFailed'), 'error'); }
    setTogglingNoAddFriend(false);
  };

  /* 切换普通成员邀请权限 */
  const toggleMemberInvite = async (val) => {
    setTogglingMemberInvite(true);
    try {
      const { data } = await axios.put(`/api/messages/conversation/${conversation.id}/manage`, { member_can_invite: val });
      setInfo(i => ({ ...i, member_can_invite: data.member_can_invite }));
    } catch (e) { showToast(e.response?.data?.error || t('common.actionFailed'), 'error'); }
    setTogglingMemberInvite(false);
  };

  /* 设置/取消管理员（仅群主） */
  const toggleAdmin = async (uid, currentRole) => {
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    const name = info.members.find(m => m.id === uid)?.username || t('groupInfo.unknownUser');
    const action = newRole === 'admin'
      ? t('groupInfo.confirmSetAdminTemplate').replace('{name}', name)
      : t('groupInfo.confirmRevokeAdminTemplate').replace('{name}', name);
    if (!(await showConfirm(action))) return;
    try {
      await axios.put(`/api/messages/conversation/${conversation.id}/members/${uid}/role`, { role: newRole });
      setInfo(i => ({ ...i, members: i.members.map(m => m.id === uid ? { ...m, role: newRole } : m) }));
    } catch (e) { showToast(e.response?.data?.error || t('common.actionFailed'), 'error'); }
  };

  /* 转让群主（仅群主） */
  const transferOwner = async (uid) => {
    const name = info.members.find(m => m.id === uid)?.username || t('groupInfo.unknownUser');
    if (!(await showConfirm(t('groupInfo.confirmTransferOwnerTemplate').replace('{name}', name)))) return;
    setTransferringOwner(true);
    try {
      await axios.post(`/api/messages/conversation/${conversation.id}/transfer-owner`, { userId: uid });
      setInfo(i => ({
        ...i,
        owner_id: uid,
        myRole: 'admin',
        members: i.members.map(m =>
          m.id === uid ? { ...m, role: 'owner' } : (m.role === 'owner' ? { ...m, role: 'admin' } : m)
        ),
      }));
      setShowTransferOwner(false);
      showToast(t('groupInfo.transferOwnerSuccess'), 'success');
    } catch (e) { showToast(e.response?.data?.error || t('groupInfo.transferOwnerFailed'), 'error'); }
    finally { setTransferringOwner(false); }
  };

  const copyInviteLink = async () => {
    if (copyingInviteLink) return;
    setCopyingInviteLink(true);
    try {
      const { data } = await axios.post(`/api/messages/conversation/${conversation.id}/invite-link`);
      const raw = data?.url || data?.link || '';
      if (!raw) throw new Error('missing invite link');
      const absolute = new URL(raw, window.location.origin).toString();
      const copied = await copyToClipboard(absolute);
      showToast(copied ? t('groupInfo.inviteLinkCopied') : t('groupInfo.inviteLinkCopyFailed'), copied ? 'success' : 'error');
    } catch (e) {
      showToast(e.response?.data?.error || t('groupInfo.inviteLinkCreateFailed'), 'error');
    } finally {
      setCopyingInviteLink(false);
    }
  };

  /* 移出成员 */
  const kickMember = async (uid) => {
    const name = info.members.find(m => m.id === uid)?.username || t('groupInfo.unknownUser');
    if (!(await showConfirm(t('groupInfo.confirmKickTemplate').replace('{name}', name), { variant: 'DANGER' }))) return;
    try {
      await axios.delete(`/api/messages/conversation/${conversation.id}/members/${uid}`);
      setInfo(i => ({ ...i, members: i.members.filter(m => m.id !== uid) }));
    } catch (e) { showToast(e.response?.data?.error || t('groupInfo.kickFailed'), 'error'); }
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
    try {
      const { data } = await axios.post(`/api/messages/conversation/${conversation.id}/invite`, { userIds: [...selectedInvite] });
      setShowInvite(false);
      load();
      // 有好友开启了"不允许直接邀请进群"的隐私保护，友好提示未能全部拉入
      const blocked = Number(data?.blocked) || 0;
      const added = Number(data?.added) || 0;
      if (blocked > 0) {
        showToast(added > 0
          ? t('groupInfo.inviteBlockedPartialTemplate').replace('{added}', added).replace('{blocked}', blocked)
          : t('groupInfo.inviteBlockedAllTemplate').replace('{blocked}', blocked), 'info');
      }
    } catch (e) { showToast(e.response?.data?.error || t('groupInfo.inviteFailed'), 'error'); }
  };

  /* 退出群聊（非群主）*/
  const leaveGroup = async () => {
    if (!(await showConfirm(t('groupInfo.confirmLeaveGroup'), { variant: 'DANGER' }))) return;
    try {
      await axios.post(`/api/messages/conversation/${conversation.id}/leave`);
      onLeave?.();
    } catch (e) { showToast(e.response?.data?.error || t('groupInfo.leaveGroupFailed'), 'error'); }
  };

  /* 解散群聊（仅群主）*/
  const dissolveGroup = async () => {
    if (!(await showConfirm(t('groupInfo.confirmDissolveGroup'), { variant: 'DANGER' }))) return;
    try {
      await axios.post(`/api/messages/conversation/${conversation.id}/dissolve`);
      onLeave?.();
    } catch (e) { showToast(e.response?.data?.error || t('groupInfo.dissolveGroupFailed'), 'error'); }
  };

  const clearMessages = async () => {
    const name = info?.name || conversation.name || t('groupInfo.thisGroupFallback');
    if (!(await showConfirm(t('groupInfo.confirmClearMessagesTemplate').replace('{name}', name), { variant: 'DANGER' }))) return;
    try {
      await axios.delete(`/api/messages/conversation/${conversation.id}/messages`);
      onCleared?.();
    } catch (e) { showToast(e.response?.data?.error || t('groupInfo.clearMessagesFailed'), 'error'); }
  };

  const exportChat = async () => {
    try {
      const { data } = await axios.get(`/api/messages/conversation/${conversation.id}/export`, { responseType: 'blob', timeout: 120000 });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `聊天记录-${info?.name || conversation.name || conversation.id}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { showToast(e.response?.data?.error || t('groupInfo.exportFailed'), 'error'); }
  };

  /* 修改群头像 */
  const uploadAvatar = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!ALLOWED_TYPES.includes(file.type)) {
      showToast(t('groupInfo.avatarTypeError'), 'error');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast(t('groupInfo.avatarSizeError'), 'error');
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
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }
      );
      setInfo(i => ({ ...i, avatar: data.avatar }));
      onConvUpdate?.({ avatar: data.avatar });
    } catch (err) {
      showToast(err.response?.data?.error || t('groupInfo.avatarUploadFailed'), 'error');
    }
    setUploadingAvatar(false);
    e.target.value = '';
  };

  if (loading) return (
    <div className="gi-panel gi-fcd gi-ccc">
      <div className="gi-fcd gi-fca gi-gap8">
        <div className="gi-spinner gi-spinner-green" />
        <span role="status" className="gi-loading-txt">{t('common.loading')}</span>
      </div>
    </div>
  );
  if (!info) return null;

  return (
    <div className="gi-panel">
      {/* 顶部栏 */}
      <div className="gi-header">
        <span className="gi-title">{t('groupInfo.title')}</span>
        <button
          className="gi-close-btn"
          onClick={onClose}
          aria-label={t('groupInfo.closeAriaLabel')}
        ><TouliaoIcon name="close" size="sm" /></button>
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
                <TouliaoField value={nameVal} onChange={e => setNameVal(e.target.value)}
                  className="tl-field-inline" controlClassName="gi-name-edit" data-testid="group-rename-input" maxLength={30}
                  aria-label={t('groupInfo.groupNameAriaLabel')} autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditName(false); }} />
                <button className="gi-btn-edit" data-testid="group-rename-save" onClick={saveName}>{t('common.save')}</button>
                <button className="gi-btn-xl" onClick={() => setEditName(false)}>{t('common.cancel')}</button>
              </div>
            ) : (
              <div className="gi-name-row">
                <span className="gi-name">{info.name}</span>
                {isAdmin && <button className="gi-btn-name" onClick={() => setEditName(true)} aria-label={t('groupInfo.editNameAriaLabel')}><TouliaoIcon name="edit" size="sm" /></button>}
              </div>
            )}
            <div className="gi-meta">
              {t('groupInfo.memberCountTemplate').replace('{count}', info.members.length)}
              {info.group_number && <span className="gi-ml8">{t('groupInfo.groupNumberLabel')}{info.group_number}</span>}
            </div>
          </div>
        </div>

        {/* 群公告 */}
        <div className="gi-section gi-section-pad">
          <div className="gi-fcsb" style={{ marginBottom: editAnn ? 8 : 6 }}>
            <div className="gi-fca gi-gap5">
              <TouliaoIcon name="owner" className="gi-s14 gi-fill-warn" size="sm" />
              <span className="gi-sec-tit">{t('groupInfo.announcementTitle')}</span>
            </div>
            {isAdmin && !editAnn && (
              <button className="gi-btn-edit" onClick={() => setEditAnn(true)}>{t('chat.edit')}</button>
            )}
          </div>
          {editAnn ? (
            <>
              <TouliaoField className="tl-field-inline" variant="MULTILINE" value={annVal} onChange={e => setAnnVal(e.target.value)}
                controlClassName="gi-ann-textarea" maxLength={500}
                autoFocus placeholder={t('groupInfo.announcementPlaceholder')} aria-label={t('groupInfo.announcementAriaLabel')}
                onKeyDown={e => { if (e.key === 'Escape') setEditAnn(false); }} />
              <div className="gi-ann-bar">
                <SecondaryButton className="gi-btn-cancel" onClick={() => setEditAnn(false)}>{t('common.cancel')}</SecondaryButton>
                <PrimaryButton className="gi-btn-save" onClick={saveAnn}>{t('common.save')}</PrimaryButton>
              </div>
            </>
          ) : (
            <div className={info.announcement ? 'gi-t13 gi-ann-preview' : 'gi-t13m gi-ann-preview'}>
              {info.announcement || t('groupInfo.noAnnouncementHint')}
            </div>
          )}
        </div>

        {/* ── 群管理（群主和管理员可见，钉钉对标设计） ── */}
        {isManageable && (
          <div className="gi-section">
            <div
              className="gi-row gi-mg-click"
              role="button"
              tabIndex={0}
              aria-label={t('groupInfo.manageTitle')}
              aria-expanded={showManage}
              onClick={() => setShowManage(v => !v)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowManage(v => !v); } }}
            >
              <div className="gi-ic30 gi-ic-mg-header">
                <TouliaoIcon name="settings" className="gi-s16 gi-fill-white" size="sm" />
              </div>
              <div className="gi-f1">
                <span className="gi-text14 gi-fw5">{t('groupInfo.manageTitle')}</span>
                {(info.mute_all || info.no_private_chat || info.no_add_friend) && (
                  <div className="gi-mg-active">
                    {[info.mute_all && t('groupInfo.muteAllLabel'), info.no_private_chat && t('groupInfo.noPrivateChatLabel'), info.no_add_friend && t('groupInfo.noAddFriendPill')].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
              <IcoBack className="gi-s14 gi-fill-grey" style={{transform:showManage?'rotate(90deg)':'none',transition:'transform 0.15s'}} />
            </div>

            {showManage && (
              <div className="gi-mg-bg">
                {/* 全员禁言 */}
                <div className="gi-mg-row">
                  <div className="gi-ic28 gi-ic-mg1">
                    <TouliaoIcon name="mute" className="gi-s14 gi-fill-warn" size="sm" />
                  </div>
                  <div className="gi-f1">
                    <div className="gi-mg-label">{t('groupInfo.muteAllLabel')}</div>
                    <div className="gi-mg-desc">{t('groupInfo.muteAllDesc')}</div>
                  </div>
                  <TouliaoSwitch value={!!info.mute_all} onChange={toggleMuteAll} disabled={togglingMute} label={t('groupInfo.muteAllLabel')} />
                </div>

                {/* 禁止私聊 */}
                <div className="gi-mg-row">
                  <div className="gi-ic28 gi-ic-mg2">
                    <TouliaoIcon name="lock" className="gi-s14 gi-fill-green" size="sm" />
                  </div>
                  <div className="gi-f1">
                    <div className="gi-mg-label">{t('groupInfo.noPrivateChatLabel')}</div>
                    <div className="gi-mg-desc">{t('groupInfo.noPrivateChatDesc')}</div>
                  </div>
                  <TouliaoSwitch value={!!info.no_private_chat} onChange={toggleNoPrivateChat} disabled={togglingNoPrivate} label={t('groupInfo.noPrivateChatLabel')} />
                </div>

                {/* 禁止群成员互相添加好友 */}
                <div className="gi-mg-row-last">
                  <div className="gi-ic28 gi-ic-mg3">
                    <IcoPersonAdd className="gi-s14 gi-fill-red" />
                  </div>
                  <div className="gi-f1">
                    <div className="gi-mg-label">{t('groupInfo.noAddFriendLabel')}</div>
                    <div className="gi-mg-desc">{t('groupInfo.noAddFriendDesc')}</div>
                  </div>
                  <TouliaoSwitch value={!!info.no_add_friend} onChange={toggleNoAddFriend} disabled={togglingNoAddFriend} label={t('groupInfo.noAddFriendLabel')} />
                </div>

                {/* 允许普通成员邀请 */}
                <div className="gi-mg-row-last">
                  <div className="gi-ic28 gi-ic-mg3">
                    <IcoContacts className="gi-s14 gi-fill-blue" />
                  </div>
                  <div className="gi-f1">
                    <div className="gi-mg-label">{t('groupInfo.memberInviteLabel')}</div>
                    <div className="gi-mg-desc">{t('groupInfo.memberInviteDesc')}</div>
                  </div>
                  <TouliaoSwitch value={!!info.member_can_invite} onChange={toggleMemberInvite} disabled={togglingMemberInvite} label={t('groupInfo.memberInviteLabel')} />
                </div>

                {isOwner && (
                  <button type="button" className="gi-mg-action" onClick={() => setShowTransferOwner(true)}>
                    <span>{t('groupInfo.transferOwnership')}</span>
                    <IcoBack className="gi-s14 gi-fill-tertiary" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 状态提示条（非管理员时展示当前限制） */}
        {!isAdmin && (info.mute_all || info.no_private_chat || info.no_add_friend) && (
          <div className="gi-warn">
            {info.mute_all && (
              <div className="gi-warn-row">
                <TouliaoIcon name="mute" className="gi-s12 gi-warn-icon" size="sm" />
                {t('groupInfo.muteAllWarning')}
              </div>
            )}
            {info.no_private_chat && (
              <div className="gi-warn-row">
                <TouliaoIcon name="warning" className="gi-s12 gi-warn-icon" size="sm" />
                {t('groupInfo.noPrivateChatWarning')}
              </div>
            )}
            {info.no_add_friend && (
              <div className="gi-warn-row">
                <TouliaoIcon name="warning" className="gi-s12 gi-warn-icon" size="sm" />
                {t('groupInfo.noAddFriendWarning')}
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
                {t('groupInfo.memberListTitleTemplate').replace('{count}', info.members.length)}
              </span>
            </div>
            {/* 仅管理员显示搜索框（用于快速找人踢出） */}
            {isAdmin && (
              <div className="gi-ml-search">
                <TouliaoIcon name="search" className="gi-s13 gi-search-icon" size="sm" />
                <input
                  value={kickSearch}
                  onChange={e => setKickSearch(e.target.value)}
                  placeholder={t('groupInfo.searchMembersPlaceholder')}
                  aria-label={t('groupInfo.searchMembersPlaceholder')}
                  className="gi-ml-si"
                />
                {kickSearch && (
                  <button className="gi-clear-search" onClick={() => setKickSearch('')} aria-label={t('groupInfo.clearSearchAriaLabel')}><TouliaoIcon name="close" size="sm" /></button>
                )}
              </div>
            )}
          </div>

          <div className="gi-ml-body">
            {/* 邀请按钮：管理员始终可见；普通成员需群开启了允许成员邀请 */}
            {!kickSearch && (isAdmin || info.member_can_invite) && (
              <div className="gi-inv-row" role="button" tabIndex={0} onClick={openInvite} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openInvite(); } }}>
                <div className="gi-inv-box"><TouliaoIcon name="addMember" size="md" /></div>
                <span className="gi-inv-txt">{t('groupInfo.inviteMember')}</span>
              </div>
            )}

            {/* 成员列表（支持搜索过滤；>50 人时虚拟化渲染） */}
            {(() => {
              const q = kickSearch.toLowerCase();
              const filtered = kickSearch
                ? info.members.filter(m => (m.username || '').toLowerCase().includes(q))
                : info.members;
              if (kickSearch && filtered.length === 0) {
                return <div className="gi-no-match">{t('groupInfo.noMatchingMembers')}</div>;
              }
              const itemData = { filtered, kickSearch, isOwner, isAdmin, currentUserId, toggleAdmin, kickMember };
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
          <div className="gi-row" style={{ cursor: 'pointer' }} role="button" tabIndex={0} onClick={() => onOpenChatFiles?.()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenChatFiles?.(); } }}>
            <span className="gi-label">{t('groupInfo.chatFiles')}</span>
            <IcoBack className="gi-s14 gi-fill-tertiary" />
          </div>
          <div className="gi-row">
            <span className="gi-label">{t('chatlist.muteChat')}</span>
            <TouliaoSwitch
              label={t('chatlist.muteChat')}
              value={myMuted}
              disabled={savingSetting}
              onChange={toggleMute}
            />
          </div>
          <div className="gi-row">
            <span className="gi-label">{t('chatlist.pinChat')}</span>
            <TouliaoSwitch
              label={t('chatlist.pinChat')}
              value={myPinned}
              disabled={savingSetting}
              onChange={togglePin}
            />
          </div>
          <div className={`gi-row${conversation.background ? '' : ' gi-row-noborder'}`} style={{ cursor: 'pointer' }} role="button" tabIndex={0} onClick={() => onPickBackground?.()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickBackground?.(); } }}>
            <span className="gi-label">{t('groupInfo.setBackground')}</span>
            <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm2)' }}>{conversation.background ? t('groupInfo.changeBackgroundCta') : t('groupInfo.chooseImageCta')}</span>
          </div>
          {conversation.background && (
            <div className="gi-row gi-row-noborder" style={{ cursor: 'pointer' }} role="button" tabIndex={0} onClick={() => onClearBackground?.()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClearBackground?.(); } }}>
              <span className="gi-label" style={{ color: 'var(--color-badge)' }}>{t('groupInfo.clearBackground')}</span>
            </div>
          )}
        </div>

        {/* 群昵称 */}
        <div className="gi-nk">
          <div className="gi-nk-hd">{t('groupInfo.myNicknameTitle')}</div>
          <div className="gi-nk-bd">
            {editNickname ? (
              <>
                <TouliaoField
                  autoFocus
                  value={nicknameVal}
                  onChange={e => setNicknameVal(e.target.value)}
                  placeholder={t('groupInfo.nicknamePlaceholder')}
                  maxLength={30}
                  aria-label={t('groupInfo.nicknameAriaLabel')}
                  className="tl-field-inline" controlClassName="gi-nick-input"
                  onKeyDown={e => { if (e.key === 'Enter') saveNickname(); if (e.key === 'Escape') setEditNickname(false); }}
                />
                <PrimaryButton className="gi-btn-save-sm" onClick={saveNickname}>{t('common.save')}</PrimaryButton>
                <button className="gi-btn-xl-sm" onClick={() => setEditNickname(false)}>{t('common.cancel')}</button>
              </>
            ) : (
              <div className="gi-f1 gi-fcsb gi-nk-cp" role="button" tabIndex={0} onClick={() => { setNicknameVal(myNickname || ''); setEditNickname(true); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setNicknameVal(myNickname || ''); setEditNickname(true); } }}>
                <span style={{ fontSize: 'var(--text-base)', color: myNickname ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{myNickname || t('groupInfo.notSet')}</span>
                <IcoBack className="gi-s14 gi-fill-tertiary" />
              </div>
            )}
          </div>
        </div>

        {/* 群二维码 */}
        <div className="gi-qr">
          <div className="gi-qr-row" role="button" tabIndex={0} onClick={loadQR} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadQR(); } }}>
            <span className="gi-text14">{t('groupInfo.qrTitle')}</span>
            <IcoBack className="gi-s14 gi-chevron" />
          </div>
          {(isAdmin || info.member_can_invite) && (
            <button type="button" className="gi-qr-row" onClick={copyInviteLink} disabled={copyingInviteLink}>
              <span className="gi-text14">{copyingInviteLink ? t('common.loading') : t('groupInfo.copyInviteLink')}</span>
              <TouliaoIcon name="link" className="gi-s14 gi-chevron" size="sm" />
            </button>
          )}
        </div>

        {/* 导出聊天记录 */}
        <div className="gi-qr">
          <div className="gi-qr-row" role="button" tabIndex={0} onClick={exportChat} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); exportChat(); } }}>
            <span className="gi-text14">{t('groupInfo.exportChat')}</span>
            <IcoBack className="gi-s14 gi-chevron" />
          </div>
        </div>

        {/* 操作按钮区 */}
        <div className="gi-actions">
          <DangerButton onClick={clearMessages} className="gi-btn-danger">
            {t('groupInfo.clearMessagesBtn')}
          </DangerButton>
          {isOwner ? (
            <DangerButton onClick={dissolveGroup} data-testid="group-dissolve-btn" className="gi-btn-danger">
              {t('groupInfo.dissolveGroupBtn')}
            </DangerButton>
          ) : (
            <DangerButton onClick={leaveGroup} data-testid="group-leave-btn" className="gi-btn-danger">
              {t('chatlist.leaveGroup')}
            </DangerButton>
          )}
        </div>
      </div>

      {/* 群二维码弹窗 */}
      {showQR && (
        <div className="wc-modal-overlay" onClick={e => e.target === e.currentTarget && setShowQR(false)}>
          <div className="wc-modal gi-qr-panel" role="dialog" aria-modal="true" aria-label={t('groupInfo.qrTitle')}>
            <div className="wc-modal-header">
              <span className="wc-modal-title">{t('groupInfo.qrTitle')}</span>
              <button className="wc-modal-close" onClick={() => setShowQR(false)} aria-label={t('home.closeQr')}><TouliaoIcon name="close" size="sm" /></button>
            </div>
            <div className="gi-qr-wrap">
              {qrData ? (
                <>
                  <img loading="lazy" src={qrData.qrCode} alt={t('groupInfo.qrTitle')} className="gi-qr-img" />
                  <div className="gi-qr-nm">{t('groupInfo.scanToJoinTemplate').replace('{name}', info?.name || '')}</div>
                  <div className="gi-qr-ex">{t('groupInfo.qrValidityHint')}</div>
                  <button
                    className="gi-save-btn"
                    onClick={async () => {
                      try {
                        const resp = await fetch(qrData.qrCode);
                        const blob = await resp.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${info?.name || '群'}_邀请码.png`;
                        a.click();
                        URL.revokeObjectURL(url);
                      } catch {
                        // 跨域下载失败时，尝试在新窗口打开
                        window.open(qrData.qrCode, '_blank');
                      }
                    }}
                  >{t('groupInfo.saveImage')}</button>
                </>
              ) : (
                <div className="gi-qr-load">{t('common.loading')}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {showTransferOwner && (
        <div className="wc-modal-overlay" onClick={e => e.target === e.currentTarget && !transferringOwner && setShowTransferOwner(false)}>
          <div className="wc-modal wide" role="dialog" aria-modal="true" aria-label={t('groupInfo.transferOwnership')}>
            <div className="wc-modal-header">
              <span className="wc-modal-title">{t('groupInfo.transferOwnership')}</span>
              <button type="button" className="wc-modal-close" onClick={() => setShowTransferOwner(false)} disabled={transferringOwner} aria-label={t('common.close')}><TouliaoIcon name="close" size="sm" /></button>
            </div>
            <div className="wc-modal-body">
              <div className="gi-inv-hint">{t('groupInfo.transferOwnerHint')}</div>
              <div className="gi-inv-list">
                {info.members.filter(member => String(member.id) !== String(currentUserId)).map(member => (
                  <button type="button" key={member.id} className="wc-group-member-item gi-transfer-member" onClick={() => transferOwner(member.id)} disabled={transferringOwner}>
                    <Avatar src={member.avatar} name={member.username} size='sm' />
                    <span className="gi-inv-name">{member.username}</span>
                    <RoleBadge role={member.role} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 邀请成员弹窗 */}
      {showInvite && (
        <div className="wc-modal-overlay" onClick={e => e.target === e.currentTarget && setShowInvite(false)}>
          <div className="wc-modal wide" role="dialog" aria-modal="true" aria-label={t('groupInfo.inviteMember')}>
            <div className="wc-modal-header">
              <span className="wc-modal-title">{t('groupInfo.inviteMember')}</span>
              <button className="wc-modal-close" onClick={() => setShowInvite(false)} aria-label={t('groupInfo.closeInviteAriaLabel')}><TouliaoIcon name="close" size="sm" /></button>
            </div>
            <div className="wc-modal-body">
              <div className="gi-inv-hint">{t('groupInfo.selectFromContactsTemplate').replace('{n}', selectedInvite.size)}</div>
              <div className="gi-inv-list">
                {myContacts.length === 0
                  ? <div className="gi-inv-empty">{t('groupInfo.allFriendsInGroup')}</div>
                  : myContacts.map(c => (
                    <div key={c.id} className="wc-group-member-item" role="checkbox" tabIndex={0} aria-checked={selectedInvite.has(c.id)} onClick={() => setSelectedInvite(prev => { const s = new Set(prev); s.has(c.id) ? s.delete(c.id) : s.add(c.id); return s; })} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setSelectedInvite(prev => { const s = new Set(prev); s.has(c.id) ? s.delete(c.id) : s.add(c.id); return s; })}>
                      <div className={`wc-group-check${selectedInvite.has(c.id) ? ' checked' : ''}`}>{selectedInvite.has(c.id) ? <TouliaoIcon name="check" size="xs" /> : null}</div>
                      <Avatar src={c.avatar} name={c.remark || c.username} size='sm' />
                      <span className="gi-inv-name">{c.remark || c.username}</span>
                    </div>
                  ))
                }
              </div>
            </div>
            <div className="wc-modal-footer">
              <button className="wc-modal-btn secondary" onClick={() => setShowInvite(false)}>{t('common.cancel')}</button>
              <button className="wc-modal-btn primary" onClick={doInvite} disabled={selectedInvite.size === 0}>{t('groupInfo.inviteCountTemplate').replace('{n}', selectedInvite.size)}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
