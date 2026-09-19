import { GhostButton, PrimaryButton, SecondaryButton, DangerButton } from '../ui-kit/Button';
import TouliaoIcon from '../ui-kit/Icon';
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import { IcoBack, IcoCheck, IcoClose, IcoPersonAdd } from './Icons';
import { useAuth } from '../contexts/AuthContext';
import { mediaUrl, useMediaCredentials } from '../utils/url';
import { showToast, showConfirm } from '../utils/toast';
import { copyToClipboard } from '../utils/clipboard';
import useFocusTrap from '../hooks/useFocusTrap';
import { formatLastOnline } from '../utils/time';
import { useI18n } from '../contexts/I18nContext';

export default function UserProfile({ userId, onClose, onStartChat, onFriendAdded, onFriendDeleted, onNudge }) {
  useMediaCredentials();
  const { t } = useI18n();
  const { user: currentUser } = useAuth();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showRemarkEdit, setShowRemarkEdit] = useState(false);
  const [remark, setRemark] = useState('');
  const [remarkSaving, setRemarkSaving] = useState(false);
  const [addStep, setAddStep] = useState('idle'); // idle | composing | sent
  const [verifyMsg, setVerifyMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [blocked, setBlocked] = useState(false);
  // 弹窗焦点陷阱：把键盘焦点锁在资料卡内，Tab 循环、关闭后还原焦点
  const trapRef = useFocusTrap(!loading && !!user);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // userId 变化时复位加载态：render 期派生（存上一次 userId），避免 effect 内同步 setState
  const [loadedId, setLoadedId] = useState(userId);
  if (userId !== loadedId) {
    setLoadedId(userId);
    setLoading(true);
    setAddStep('idle');
    setErrMsg('');
  }

  useEffect(() => {
    let alive = true;
    axios.get(`/api/users/${userId}`).then(r => {
      if (!alive) return;
      setUser(r.data);
      setBlocked(!!r.data.isBlocked);
      if (r.data.isFriend) setAddStep('idle');
      else if (r.data.hasPendingRequest) setAddStep('sent');
      setLoading(false);
    }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [userId]);

  const sendRequest = async () => {
    setSending(true);
    setErrMsg('');
    try {
      const { data } = await axios.post('/api/users/friend-request', { toId: userId, message: verifyMsg.trim() || t('up.iAmTemplate').replace('{name}', user?.username || '') });
      if (data.autoAccepted) {
        // 对方免验证，直接成为好友
        setUser(u => ({ ...u, isFriend: true }));
        onFriendAdded?.();
      } else {
        setAddStep('sent');
        onFriendAdded?.();
      }
    } catch (err) {
      const msg = err.response?.data?.error || t('up.sendFailedDefault');
      setErrMsg(msg);
      // 若服务端说已是好友或请求已存在，同步本地状态
      if (msg === '已是好友') {
        setUser(u => u ? { ...u, isFriend: true } : u);
      } else if (msg === '请求已发送') {
        setAddStep('sent');
      }
    }
    setSending(false);
  };

  const saveRemark = async () => {
    setRemarkSaving(true);
    try {
      const next = remark.trim();
      await axios.put(`/api/users/contacts/${userId}/remark`, { remark: next });
      setUser(u => ({ ...u, remark: next }));
      setShowRemarkEdit(false);
      window.dispatchEvent(new CustomEvent('touliao:remark-changed', { detail: { userId, remark: next } }));
      onFriendAdded?.();
    } catch (err) {
      setErrMsg(err.response?.data?.error || t('up.saveFailed'));
    }
    setRemarkSaving(false);
  };

  const deleteFriend = async () => {
    if (!(await showConfirm(t('up.confirmDeleteFriendTemplate').replace('{name}', user.remark || user.username), { variant: 'DANGER' }))) return;
    try {
      await axios.delete(`/api/users/contacts/${userId}`);
      onFriendAdded?.();
      onFriendDeleted?.();
      onClose();
    } catch (e) {
      // 删除失败时不关闭弹窗，提示用户以免误以为已删除
      showToast(e.response?.data?.error || t('contacts.deleteFailed'), 'error');
    }
  };

  const toggleBlock = async () => {
    try {
      if (blocked) {
        await axios.delete(`/api/users/block/${userId}`);
        setBlocked(false);
      } else {
        if (!(await showConfirm(t('up.confirmBlacklistTemplate').replace('{name}', user.remark || user.username)))) return;
        await axios.post(`/api/users/block/${userId}`);
        setBlocked(true);
      }
    } catch (e) {
      showToast(e.response?.data?.error || t('common.actionFailed'), 'error');
    }
  };

  const startChat = async () => {
    try {
      const { data } = await axios.post('/api/messages/conversation/private', { userId });
      onStartChat?.({ id: data.conversationId, type: 'private', name: user.remark || user.username, avatar: user.avatar, otherUser: user });
      onClose();
    } catch (e) {
      showToast(e.response?.data?.error || t('up.openChatFailed'), 'error');
    }
  };

  if (loading) return (
    <div className="up-overlay" onClick={onClose}>
      <div className="up-card" role="dialog" aria-modal="true" aria-label={t('up.contactProfile')} onClick={e => e.stopPropagation()} style={{ alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
        <div className="up-loading-dot" />
      </div>
    </div>
  );
  if (!user) return null;

  const displayName = user.remark || user.username;

  return (
    <div className="up-overlay" ref={trapRef} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="up-card" role="dialog" aria-modal="true" aria-label={t('up.contactProfile')} onClick={e => e.stopPropagation()}>

        {/* 顶部封面区 */}
        <div className="up-header">
          {user.cover_photo
            ? <img key={mediaUrl(user.cover_photo)} src={mediaUrl(user.cover_photo)} loading="lazy" className="up-cover" alt=""
                   onError={e => { e.currentTarget.onerror = null; e.currentTarget.className = 'up-cover-default'; e.currentTarget.removeAttribute('src'); }} />
            : <div className="up-cover-default" />
          }
          <button className="up-close-btn" onClick={onClose} aria-label={t('common.close')}>
            <IcoClose size="sm" />
          </button>
          <div className="up-avatar-wrap">
            <Avatar src={user.avatar} name={displayName} size='xl' style={{ borderRadius: 'var(--radius-bubble-tip)', boxShadow: '0 2px 12px rgba(0,0,0,.3)' }} />
          </div>
        </div>

        {/* 名字 + ID */}
        <div className="up-identity">
          <div className="up-name">{displayName}</div>
          {user.remark && <div className="up-sub">{t('gs.nicknameLabel')}{user.username}</div>}
          {user.wechat_id && (
            <button
              type="button"
              className="up-sub up-copyable"
              title={t('profile.clickToCopyTouliaoId')}
              aria-label={`${t('home.wechatIdLabel')} ${user.wechat_id}，${t('profile.clickToCopyTouliaoId')}`}
              onClick={async () => { const ok = await copyToClipboard(user.wechat_id); showToast(ok ? t('profile.copiedTouliaoId') : t('profile.copyFailedManual'), ok ? 'success' : 'error'); }}
            >{t('profile.touliaoIdColonTemplate').replace('{id}', user.wechat_id)}</button>
          )}
          {user.bio && <div className="up-bio">{user.bio}</div>}
          {/* 特权账户：精确最后在线时间 */}
          {user.last_online_at !== undefined && (() => {
            const label = formatLastOnline(user.last_online_at, user.status === 'online');
            return label ? (
              <div className="up-last-online" title={t('up.lastOnlineTitle')}>
                <TouliaoIcon name={user.status === 'online' ? "selected" : "clock3"} size="xs" tone="secondary" /> {label}
              </div>
            ) : null;
          })()}
        </div>

        {/* 好友信息行 */}
        {user.isFriend && (
          <div className="up-rows">
            <button type="button" className="up-row" onClick={() => { setRemark(user.remark || ''); setShowRemarkEdit(true); }}>
              <span className="up-row-label">{t('up.remarkNameLabel')}</span>
              <span className="up-row-value">{user.remark || <span style={{ color: 'var(--text-tertiary)' }}>{t('up.notSet')}</span>}</span>
              <IcoBack style={{color:"var(--text-tertiary)"}} size="xs" />
            </button>
            {user.phone && (
              <div className="up-row">
                <span className="up-row-label">{t('profile.phoneLabel')}</span>
                <span className="up-row-value">{user.phone}</span>
              </div>
            )}
          </div>
        )}

        {/* 备注编辑内嵌 */}
        {showRemarkEdit && (
          <div className="up-remark-box">
            <div className="up-remark-label">{t('up.setRemarkLabel')}</div>
            <input
              className="up-remark-input"
              placeholder={t('up.remarkPlaceholder')}
              value={remark}
              onChange={e => setRemark(e.target.value)}
              autoFocus
              maxLength={20}
            />
            <div className="up-remark-actions">
              <GhostButton className="up-btn-ghost" onClick={() => setShowRemarkEdit(false)}>{t('common.cancel')}</GhostButton>
              <PrimaryButton className="up-btn-primary" onClick={saveRemark} disabled={remarkSaving}>
                {remarkSaving ? t('up.saving') : t('common.confirm')}
              </PrimaryButton>
            </div>
          </div>
        )}

        {/* 申请好友区域（非好友） */}
        {!user.isFriend && userId !== currentUser?.id && (
          <div className="up-add-area">
            {addStep === 'idle' && (
              <PrimaryButton className="up-btn-primary up-btn-full" onClick={() => setAddStep('composing')}>
                <IcoPersonAdd style={{marginRight:6}} size="xs" />
                {t('up.applyAddFriend')}
              </PrimaryButton>
            )}
            {addStep === 'composing' && (
              <div className="up-verify-box">
                <div className="up-verify-label">{t('up.verifyMessageLabel')}</div>
                <textarea
                  className="up-verify-input"
                  placeholder={t('up.iAmTemplate').replace('{name}', user.username)}
                  value={verifyMsg}
                  onChange={e => setVerifyMsg(e.target.value)}
                  maxLength={100}
                  autoFocus
                  rows={3}
                />
                {errMsg && <div className="up-err">{errMsg}</div>}
                <div className="up-verify-actions">
                  <GhostButton className="up-btn-ghost" onClick={() => { setAddStep('idle'); setErrMsg(''); }}>{t('common.cancel')}</GhostButton>
                  <PrimaryButton className="up-btn-primary" onClick={sendRequest} disabled={sending}>
                    {sending ? t('fwd.sending') : t('up.sendApplication')}
                  </PrimaryButton>
                </div>
              </div>
            )}
            {addStep === 'sent' && (
              <div className="up-sent-tip">
                <IcoCheck style={{flexShrink:0}} tone="selected" size="xs" />
                {t('up.applicationSentTip')}
              </div>
            )}
          </div>
        )}

        {/* 好友操作按钮 */}
        {user.isFriend && (
          <div className="up-actions">
            <PrimaryButton className="up-action-btn up-action-chat" onClick={startChat}>
              <TouliaoIcon name="chat" size="sm" />
              <span>{t('up.sendMessage')}</span>
            </PrimaryButton>
            {onNudge && userId !== currentUser?.id && (
              <SecondaryButton className="up-action-btn up-action-grey" onClick={() => { onNudge(userId); showToast(t('up.nudgeSentToast')); onClose?.(); }}>
                <TouliaoIcon name="nudge" size="sm" />
                <span>{t('up.nudge')}</span>
              </SecondaryButton>
            )}
            <button className={`up-action-btn ${blocked ? 'up-action-warn' : 'up-action-grey'}`} onClick={toggleBlock}>
              <TouliaoIcon name="blocked" size="sm" />
              <span>{blocked ? t('up.blacklistedVerb') : t('up.blacklistVerb')}</span>
            </button>
            <DangerButton className="up-action-btn up-action-danger" onClick={deleteFriend}>
              <TouliaoIcon name="delete" size="sm" />
              <span>{t('chat.delete')}</span>
            </DangerButton>
          </div>
        )}
      </div>
    </div>
  );
}
