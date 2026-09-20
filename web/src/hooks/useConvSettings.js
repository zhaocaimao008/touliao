import { useSocialRevision } from './useSocialRevision';
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { showToast } from '../utils/toast';

/**
 * 会话「免打扰 / 置顶」设置逻辑（GroupInfo 与 PrivateChatSettings 共用）。
 *
 * 抽取动机：两个设置面板此前各自重复实现了完全相同的 mute/pin state +
 * `/mute` `/pin` API 调用（含乐观回退与错误 toast），仅 UI 外观不同。此 hook
 * 只封装「逻辑」，不涉及任何 markup —— 两个面板保留各自的开关样式，零视觉回归。
 *
 * @param {object}   conversation           当前会话（读 id / muted / pinned 初值）
 * @param {function} onConvUpdate           成功后回传变更给父组件（同步会话列表等）
 * @returns {{ muted, pinned, saving, setSaving, toggleMute, togglePin }}
 *          setSaving 暴露给面板复用同一忙碌标志（如私聊「双向删除」与开关互斥）。
 */
export function useConvSettings(conversation, onConvUpdate) {
  const socialRevision = useSocialRevision();
  const [muted, setMuted]   = useState(!!conversation.muted);
  const [pinned, setPinned] = useState(!!conversation.pinned);
  const [saving, setSaving] = useState(false);
  const [mutationRevision, refreshAfterWrite] = useState(0);
  const onUpdate = useRef(onConvUpdate);
  onUpdate.current = onConvUpdate;

  useEffect(() => {
    let alive = true;
    axios.get('/api/messages/conversations', { params: { includeArchived: 1 } }).then(({ data }) => {
      if (!alive) return;
      const current = data.find(c => c.id === conversation.id);
      if (current) {
        setMuted(!!current.muted); setPinned(!!current.pinned);
        onUpdate.current?.({ muted: current.muted, pinned: current.pinned });
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [conversation.id, socialRevision, mutationRevision]);

  const toggleMute = async (val) => {
    setSaving(true);
    try {
      await axios.post(`/api/messages/conversation/${conversation.id}/mute`, { muted: val ? 1 : 0 });
      refreshAfterWrite(value => value + 1);
    } catch { showToast('操作失败', 'error'); }
    setSaving(false);
  };

  const togglePin = async (val) => {
    setSaving(true);
    try {
      await axios.post(`/api/messages/conversation/${conversation.id}/pin`, { pinned: val ? 1 : 0 });
      refreshAfterWrite(value => value + 1);
    } catch { showToast('操作失败', 'error'); }
    setSaving(false);
  };

  return { muted, pinned, saving, setSaving, toggleMute, togglePin };
}
