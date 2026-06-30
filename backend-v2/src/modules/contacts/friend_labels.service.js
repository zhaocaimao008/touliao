'use strict';
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');
const { badRequest, notFound, forbidden } = require('../../utils/http');

function listLabels(userId) {
  const labels = db.prepare('SELECT * FROM friend_labels WHERE user_id=? ORDER BY created_at ASC').all(userId);
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

function createLabel(userId, { name, color }) {
  if (!name || !name.trim()) throw badRequest('标签名不能为空');
  if (name.trim().length > 20) throw badRequest('标签名最多20字符');
  const id = uuidv4();
  db.prepare('INSERT INTO friend_labels (id, user_id, name, color) VALUES (?, ?, ?, ?)')
    .run(id, userId, name.trim(), color || '#07C160');
  return { id, user_id: userId, name: name.trim(), color: color || '#07C160', members: [] };
}

function updateLabel(userId, labelId, { name, color }) {
  const label = db.prepare('SELECT * FROM friend_labels WHERE id=? AND user_id=?').get(labelId, userId);
  if (!label) throw notFound('标签不存在');
  const newName = (name || label.name).trim();
  const newColor = color || label.color;
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
