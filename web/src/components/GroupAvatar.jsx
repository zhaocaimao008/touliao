import React, { useState } from 'react';
import Avatar, { getColor } from './Avatar';
import { mediaUrl } from '../utils/url';
import { useI18n } from '../contexts/I18nContext';

/** 宫格单元：头像失败回退首字母 */
function GroupGridCell({ member = {}, cellSize }) {
  const [err, setErr] = useState(false);
  const [prevAvatar, setPrevAvatar] = useState(member.avatar);
  if (member.avatar !== prevAvatar) { setPrevAvatar(member.avatar); setErr(false); }
  return (
    <div style={{ width: cellSize, height: cellSize, borderRadius: 'var(--radius-xs)', overflow: 'hidden', background: getColor(member.username || '?'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {member.avatar && !err
        ? <img loading="lazy" src={mediaUrl(member.avatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setErr(true)} />
        : <span style={{ fontSize: cellSize * 0.45, fontWeight: 600, color: 'var(--text-inverse)' }}>{(member.username || '?')[0]}</span>}
    </div>
  );
}

/** 群头像拼图（微信风格 N宫格，支持自定义头像） */
export function GroupAvatar({ members = [], size = 48, avatar = '' }) {
  const { t } = useI18n();
  const [avatarErr, setAvatarErr] = useState(false);
  const [prevAvatar, setPrevAvatar] = useState(avatar);
  if (avatar !== prevAvatar) { setPrevAvatar(avatar); setAvatarErr(false); }
  if (avatar && !avatarErr) {
    return <img src={mediaUrl(avatar)} alt="" loading="lazy" onError={() => setAvatarErr(true)} style={{ width: size, height: size, borderRadius: Math.max(3, Math.round(size * 0.13)), objectFit: 'cover', flexShrink: 0 }} />;
  }
  const n = Math.min(members.length, 9);
  if (n === 0) return <Avatar name={t('groupAvatar.fallbackName')} size={size} />;
  if (n === 1) return <Avatar src={members[0].avatar} name={members[0].username} size={size} />;
  const grid = n <= 4 ? 2 : 3;
  const cellSize = Math.floor((size - (grid + 1) * 2) / grid);
  return (
    <div style={{ width: size, height: size, borderRadius: Math.max(3, Math.round(size * 0.13)), background: 'var(--bg-input-search)', display: 'grid', overflow: 'hidden', gridTemplateColumns: `repeat(${grid}, ${cellSize}px)`, gap: 2, padding: 2, flexShrink: 0 }}>
      {members.slice(0, grid * grid).map((m, i) => (
        <GroupGridCell key={m.id ?? m.username ?? i} member={m} cellSize={cellSize} />
      ))}
    </div>
  );
}
