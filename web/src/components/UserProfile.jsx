import { TouliaoButton, GhostButton, PrimaryButton, SecondaryButton, DangerButton } from '../ui-kit/Button';
import TouliaoIcon from '../ui-kit/Icon';
import React, { useState, useRef } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import { IcoBack, IcoCheck, IcoClose, IcoPersonAdd } from './Icons';
import { useAuth } from '../contexts/AuthContext';
import { mediaUrl, useMediaCredentials } from '../utils/url';
import { showToast, showConfirm } from '../utils/toast';
import { copyToClipboard } from '../utils/clipboard';
import useFocusTrap from '../hooks/useFocusTrap';
import { formatLastOnline } from '../utils/time';
import { useProfileResource } from '../hooks/useProfileResource';
import { useDirectoryAction } from '../hooks/useDirectoryAction';
import { useDiscardChanges } from '../hooks/useDiscardChanges';
import { ErrorState } from './StateViews';
import { keepSettingFocus } from '../utils/settingFocus';
import { useI18n } from '../contexts/I18nContext';

export default function UserProfile(props) {
  return <UserProfileCard key={props.userId} {...props} />;
}

function UserProfileCard({ userId, onClose, onStartChat, onFriendAdded, onFriendDeleted, onNudge }) {
  useMediaCredentials();
  const { t } = useI18n();
  const { user: currentUser } = useAuth();
  const resource = useProfileResource(userId);
  const { user, loading } = resource;
  const [showRemarkEdit, setShowRemarkEdit] = useState(false);
  const [remark, setRemark] = useState('');
  const [composing, setComposing] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState('');
  const remarkTrigger = useRef(null);
  const addTrigger = useRef(null);
  const action = useDirectoryAction(JSON.stringify([userId, showRemarkEdit, composing]));
  const busy = !!action.pendingKey;
  const blocked = !!user?.isBlocked;
  const addStep = user?.hasPendingRequest ? 'sent' : composing ? 'composing' : 'idle';
  const dirty = (showRemarkEdit && remark.trim() !== (user?.remark || '')) || (addStep === 'composing' && !!verifyMsg.trim());
  const guard = useDiscardChanges({ dirty, busy, message: t('up.discardDraft') });
  const closeEditor = () => {
    setShowRemarkEdit(false); setComposing(false); setVerifyMsg('');
    requestAnimationFrame(() => (remarkTrigger.current || addTrigger.current)?.focus());
  };
  const requestClose = () => guard(onClose);
  const trapRef = useFocusTrap(true, { lockScroll: true,
    onEscape: () => guard(showRemarkEdit || addStep === 'composing' ? closeEditor : onClose) });
  const acknowledged = async response => {
    const { data } = await response;
    if (data?.success !== true) throw new Error('Unconfirmed profile action');
    return data;
  };
  const mutate = options => action.run({ reconcile: resource.reload, ...options });
  const sendRequest = () => mutate({
    key: 'request',
    request: config => acknowledged(axios.post('/api/users/friend-request', {
      toId: userId, message: verifyMsg.trim() || t('up.iAmTemplate').replace('{name}', currentUser?.username || ''),
    }, config)),
    commit: data => resource.commit(previous => ({ ...previous,
      isFriend: data.autoAccepted === true || !data.id,
      hasPendingRequest: data.autoAccepted !== true && !!data.id,
    })),
    onSuccess: () => { setComposing(false); setVerifyMsg(''); onFriendAdded?.(); },
  });
  const saveRemark = () => {
    const next = remark.trim();
    return mutate({
      key: 'remark',
      request: config => acknowledged(axios.put(`/api/users/contacts/${userId}/remark`, { remark: next }, config)),
      commit: () => {
        resource.commit(previous => ({ ...previous, remark: next }));
        window.dispatchEvent(new CustomEvent('touliao:remark-changed', { detail: { userId, remark: next } }));
      },
      onSuccess: () => { closeEditor(); onFriendAdded?.(); },
    });
  };
  const deleteFriend = () => mutate({
    key: 'delete',
    confirm: () => showConfirm(t('up.confirmDeleteFriendTemplate').replace('{name}', user.remark || user.username), { variant: 'DANGER' }),
    request: config => acknowledged(axios.delete(`/api/users/contacts/${userId}`, config)),
    onSuccess: () => { onFriendAdded?.(); onFriendDeleted?.(); onClose(); },
  });
  const toggleBlock = () => mutate({
    key: 'block',
    confirm: blocked ? undefined : () => showConfirm(t('up.confirmBlacklistTemplate').replace('{name}', user.remark || user.username) + '\n' + t('up.blacklistEffectNote')),
    request: async config => {
      const data = await acknowledged(blocked
        ? axios.delete(`/api/users/block/${userId}`, config)
        : axios.post(`/api/users/block/${userId}`, undefined, config));
      if (data.blocked !== !blocked) throw new Error('Unconfirmed block state');
      return data;
    },
    commit: data => resource.commit(previous => ({ ...previous, isBlocked: data.blocked })),
  });
  const startChat = () => action.run({
    key: 'chat',
    request: async config => {
      const { data } = await axios.post('/api/messages/conversation/private', { userId }, config);
      if (typeof data?.conversationId !== 'string' || !data.conversationId.trim() || data.conversationId.startsWith('__')) throw new Error('Invalid conversation');
      return { id: data.conversationId, type: 'private', name: user.remark || user.username, avatar: user.avatar, otherUser: user };
    },
    onSuccess: conversation => { onStartChat?.(conversation); onClose(); },
  });
  const displayName = user?.remark || user?.username;
  const actionDisabled = busy || loading || showRemarkEdit;

  return (
    <div className="up-overlay" ref={trapRef} onClick={e => e.target === e.currentTarget && requestClose()}>
      <div className="up-card" role="dialog" aria-modal="true" aria-label={t('up.contactProfile')} onClick={e => e.stopPropagation()}>
        <button className="up-close-btn" onClick={requestClose} disabled={busy} aria-label={t('common.close')}>
          <IcoClose size="sm" />
        </button>

        {!user ? <>
          <div className="up-state-header">
            <span>{t('up.contactProfile')}</span>
          </div>
          {loading ? <div className="up-load-state" role="status"><span className="up-loading-dot" aria-hidden="true" />{t('common.loading')}</div>
            : <ErrorState onRetry={() => keepSettingFocus(resource.reload)} />}
        </> : <>
        {/* 顶部封面区 */}
        <div className="up-header">
          {user.cover_photo
            ? <img key={mediaUrl(user.cover_photo)} src={mediaUrl(user.cover_photo)} loading="lazy" className="up-cover" alt=""
                   onError={e => { e.currentTarget.onerror = null; e.currentTarget.className = 'up-cover-default'; e.currentTarget.removeAttribute('src'); }} />
            : <div className="up-cover-default" />
          }
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
            <button ref={remarkTrigger} type="button" className="up-row" disabled={busy || loading || showRemarkEdit} onClick={() => { setRemark(user.remark || ''); setShowRemarkEdit(true); }}>
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
          <form className="up-remark-box" onSubmit={e => { e.preventDefault(); return keepSettingFocus(saveRemark); }}>
            <div className="up-remark-label">{t('up.setRemarkLabel')}</div>
            <input
              className="up-remark-input"
              aria-label={t('up.remarkNameLabel')}
              disabled={busy}
              onKeyDown={e => { if (e.key === 'Enter' && (e.nativeEvent?.isComposing || e.keyCode === 229)) e.preventDefault(); }}
              placeholder={t('up.remarkPlaceholder')}
              value={remark}
              onChange={e => setRemark(e.target.value)}
              autoFocus
              maxLength={20}
            />
            <div className="up-remark-actions">
              <GhostButton className="up-btn-ghost" disabled={busy} onClick={() => guard(closeEditor)}>{t('common.cancel')}</GhostButton>
              <PrimaryButton className="up-btn-primary" type="submit" disabled={busy} loading={action.pendingKey === 'remark'}>
                {action.pendingKey === 'remark' ? t('up.saving') : t('common.confirm')}
              </PrimaryButton>
            </div>
          </form>
        )}

        {/* 申请好友区域（非好友） */}
        {!user.isFriend && userId !== currentUser?.id && (
          <div className="up-add-area">
            {addStep === 'idle' && (
              <TouliaoButton ref={addTrigger} className="up-btn-primary up-btn-full" disabled={busy || loading} onClick={() => setComposing(true)}>
                <IcoPersonAdd style={{marginRight:6}} size="xs" />
                {t('up.applyAddFriend')}
              </TouliaoButton>
            )}
            {addStep === 'composing' && (
              <div className="up-verify-box">
                <div className="up-verify-label">{t('up.verifyMessageLabel')}</div>
                <textarea
                  className="up-verify-input"
                  aria-label={t('up.verifyMessageLabel')}
                  disabled={busy}
                  placeholder={t('up.iAmTemplate').replace('{name}', currentUser?.username || '')}
                  value={verifyMsg}
                  onChange={e => setVerifyMsg(e.target.value)}
                  maxLength={100}
                  autoFocus
                  rows={3}
                />
                <div className="up-verify-actions">
                  <GhostButton className="up-btn-ghost" disabled={busy} onClick={() => guard(closeEditor)}>{t('common.cancel')}</GhostButton>
                  <PrimaryButton className="up-btn-primary" onClick={() => keepSettingFocus(sendRequest)} disabled={busy} loading={action.pendingKey === 'request'}>
                    {action.pendingKey === 'request' ? t('fwd.sending') : t('up.sendApplication')}
                  </PrimaryButton>
                </div>
              </div>
            )}
            {addStep === 'sent' && (
              <div className="up-sent-tip" role="status">
                <IcoCheck style={{flexShrink:0}} tone="selected" size="xs" />
                {t('up.applicationSentTip')}
              </div>
            )}
          </div>
        )}

        <div className="up-feedback">
          {busy && <div role="status">{t('contacts.processing')}</div>}
          {!busy && loading && <div role="status">{t('common.loading')}</div>}
          {action.error && <div className="up-err" role="alert">{action.errorDetail || t('up.actionUnconfirmed')}</div>}
          {resource.error && <ErrorState onRetry={() => keepSettingFocus(resource.reload)} />}
        </div>
        {/* 好友操作按钮 */}
        {user.isFriend && (
          <div className="up-actions">
            <PrimaryButton className="up-action-btn up-action-chat" disabled={actionDisabled} onClick={() => keepSettingFocus(startChat)}>
              <TouliaoIcon name="chat" size="sm" />
              <span>{t('up.sendMessage')}</span>
            </PrimaryButton>
            {onNudge && userId !== currentUser?.id && (
              <SecondaryButton className="up-action-btn up-action-grey" disabled={actionDisabled} onClick={() => { onNudge(userId); showToast(t('up.nudgeSentToast')); onClose?.(); }}>
                <TouliaoIcon name="nudge" size="sm" />
                <span>{t('up.nudge')}</span>
              </SecondaryButton>
            )}
            <button className={`up-action-btn ${blocked ? 'up-action-warn' : 'up-action-grey'}`} disabled={actionDisabled} onClick={() => keepSettingFocus(toggleBlock)}>
              <TouliaoIcon name="blocked" size="sm" />
              <span>{blocked ? t('up.blacklistedVerb') : t('up.blacklistVerb')}</span>
            </button>
            <DangerButton className="up-action-btn up-action-danger" disabled={actionDisabled} onClick={() => keepSettingFocus(deleteFriend)}>
              <TouliaoIcon name="delete" size="sm" />
              <span>{t('chat.delete')}</span>
            </DangerButton>
          </div>
        )}
        {/* 黑名单作用范围说明（合规披露，紧挨拉黑按钮）：原先夹在封面与名字之间，压在浮起的头像上 */}
        {user.isFriend && <p className="up-safety-note">{t('up.blacklistEffectNote')}</p>}
        </>}
      </div>
    </div>
  );
}
