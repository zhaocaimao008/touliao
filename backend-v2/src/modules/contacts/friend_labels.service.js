'use strict';
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');
const { badRequest, notFound, forbidden } = require('../../utils/http');

function listLabels(userId) {
  const labels = db.prepare('SELECT * FROM friend_labels WHERE user_id=? ORDER BY created_at ASC LIMIT 50').all(userId);
  const members = labels.length ? db.prepare(`
    SELECT flm.label_id, u.id, u.username, u.avatar
    FROM friend_label_members flm
    JOIN users u ON u.id = flm.friend_id
    WHERE flm.label_id IN (${labels.map(() => '?').join(',')})
  `).all(labels.map(l => l.id)) : [];
  const memberMap = new Map();
  members.forEach(m => {
    if (!memberMap.has(m.label_id)) memberMap.set(m.label_id, []);
    memberMap.get(m.label_id).push({ id: m.id, username: m.username, avatar: m.avatar });
  });
  return labels.map(l => ({ ...l, members: memberMap.get(l.id) || [] }));
}

const COLOR_RE = /^#[0-9A-Fa-f]{3,8}$/;
function safeColor(c, fallback) {
  return (typeof c === 'string' && COLOR_RE.test(c)) ? c : fallback;
}

function createLabel(userId, { name, color }) {
  if (!name || !name.trim()) throw badRequest('标签名不能为空');
  if (name.trim().length > 20) throw badRequest('标签名最多20字符');
  const labelCount = db.prepare('SELECT COUNT(*) n FROM friend_labels WHERE user_id=?').get(userId).n;
  if (labelCount >= 50) throw badRequest('好友标签最多 50 个');
  const id = uuidv4();
  const c = safeColor(color, '#07C160');
  db.prepare('INSERT INTO friend_labels (id, user_id, name, color) VALUES (?, ?, ?, ?)')
    .run(id, userId, name.trim(), c);
  return { id, user_id: userId, name: name.trim(), color: c, members: [] };
}

function updateLabel(userId, labelId, { name, color }) {
  const label = db.prepare('SELECT * FROM friend_labels WHERE id=? AND user_id=?').get(labelId, userId);
  if (!label) throw notFound('标签不存在');
  const newName = (name !== undefined ? String(name) : label.name).trim();
  if (!newName) throw badRequest('标签名不能为空');
  if (newName.length > 20) throw badRequest('标签名最多20字符');
  const newColor = safeColor(color, label.color);
  db.prepare('UPDATE friend_labels SET name=?, color=? WHERE id=?').run(newName, newColor, labelId);
  return { ...label, name: newName, color: newColor };
}

function deleteLabel(userId, labelId) {
  const label = db.prepare('SELECT id FROM friend_labels WHERE id=? AND user_id=?').get(labelId, userId);
  if (!label) throw notFound('标签不存在');
  db.prepare('DELETE FROM friend_labels WHERE id=?').run(labelId);
}

function addMember(userId, labelId, friendId) {
  const label = db.prepare('SELECT id FROM friend_labels WHERE id=? AND user_id=?').get(labelId, userId);
  if (!label) throw notFound('标签不存在');
  const isFriend = db.prepare('SELECT 1 FROM contacts WHERE user_id=? AND contact_id=?').get(userId, friendId);
  if (!isFriend) throw badRequest('只能将好友加入标签');
  const friend = db.prepare('SELECT id, username, avatar FROM users WHERE id=?').get(friendId);
  if (!friend) throw notFound('用户不存在');
  db.prepare('INSERT OR IGNORE INTO friend_label_members (label_id, friend_id) VALUES (?, ?)').run(labelId, friendId);
  return { id: friend.id, username: friend.username, avatar: friend.avatar };
}

function removeMember(userId, labelId, friendId) {
  const label = db.prepare('SELECT id FROM friend_labels WHERE id=? AND user_id=?').get(labelId, userId);
  if (!label) throw notFound('标签不存在');
  db.prepare('DELETE FROM friend_label_members WHERE label_id=? AND friend_id=?').run(labelId, friendId);
}

module.exports = { listLabels, createLabel, updateLabel, deleteLabel, addMember, removeMember };
