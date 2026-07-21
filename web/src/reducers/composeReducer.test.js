import { describe, it, expect } from 'vitest';
import { composeReducer, initialComposeState } from './composeReducer';

const S = (over = {}) => ({ ...initialComposeState, ...over });

describe('composeReducer', () => {
  it('初始状态：空输入、非语音、无编辑/回复', () => {
    expect(initialComposeState).toEqual({
      input: '', voiceMode: false, editingMsg: null, replyTo: null,
    });
  });

  it('未知 action 返回原状态引用（无副作用）', () => {
    const s = S({ input: 'hi' });
    expect(composeReducer(s, { type: 'NOPE' })).toBe(s);
  });

  describe('文本输入', () => {
    it('SET_INPUT 覆盖输入', () => {
      expect(composeReducer(S(), { type: 'SET_INPUT', value: 'abc' }).input).toBe('abc');
    });
    it('APPEND_INPUT 基于当前值追加（emoji 插入）', () => {
      expect(composeReducer(S({ input: 'ab' }), { type: 'APPEND_INPUT', text: '😀' }).input).toBe('ab😀');
    });
    it('REPLACE_INPUT 替换为完整文本（@提及插入）', () => {
      expect(composeReducer(S({ input: '@zh' }), { type: 'REPLACE_INPUT', value: '@zhang ' }).input).toBe('@zhang ');
    });
    it('文本操作不改动其他字段', () => {
      const s = S({ voiceMode: true, replyTo: { id: 1 } });
      const n = composeReducer(s, { type: 'SET_INPUT', value: 'x' });
      expect(n.voiceMode).toBe(true);
      expect(n.replyTo).toEqual({ id: 1 });
    });
  });

  describe('语音模式', () => {
    it('TOGGLE_VOICE 翻转', () => {
      expect(composeReducer(S(), { type: 'TOGGLE_VOICE' }).voiceMode).toBe(true);
      expect(composeReducer(S({ voiceMode: true }), { type: 'TOGGLE_VOICE' }).voiceMode).toBe(false);
    });
  });

  describe('编辑与回复互斥（核心不变量）', () => {
    it('START_EDIT：载入原文 + 进编辑态 + 清回复', () => {
      const s = S({ replyTo: { id: 9 }, input: 'draft' });
      const n = composeReducer(s, { type: 'START_EDIT', msg: { id: 5, content: 'hello' } });
      expect(n.editingMsg).toEqual({ id: 5, content: 'hello' });
      expect(n.input).toBe('hello');
      expect(n.replyTo).toBeNull();
    });
    it('START_EDIT 只取 id/content，忽略多余字段', () => {
      const n = composeReducer(S(), { type: 'START_EDIT', msg: { id: 5, content: 'x', extra: 'y', senderName: 'z' } });
      expect(n.editingMsg).toEqual({ id: 5, content: 'x' });
    });
    it('CANCEL_EDIT：退编辑 + 清输入', () => {
      const s = S({ editingMsg: { id: 5, content: 'x' }, input: 'x' });
      const n = composeReducer(s, { type: 'CANCEL_EDIT' });
      expect(n.editingMsg).toBeNull();
      expect(n.input).toBe('');
    });
    it('SET_REPLY：进回复态 + 清编辑', () => {
      const s = S({ editingMsg: { id: 5, content: 'x' } });
      const n = composeReducer(s, { type: 'SET_REPLY', msg: { id: 7, senderName: 'a' } });
      expect(n.replyTo).toEqual({ id: 7, senderName: 'a' });
      expect(n.editingMsg).toBeNull();
    });
    it('编辑态下设回复 → 编辑被清除（不会二者并存）', () => {
      const editing = composeReducer(S(), { type: 'START_EDIT', msg: { id: 1, content: 'c' } });
      const replied = composeReducer(editing, { type: 'SET_REPLY', msg: { id: 2 } });
      expect(replied.editingMsg).toBeNull();
      expect(replied.replyTo).toEqual({ id: 2 });
    });
    it('回复态下开始编辑 → 回复被清除', () => {
      const replied = composeReducer(S(), { type: 'SET_REPLY', msg: { id: 2 } });
      const editing = composeReducer(replied, { type: 'START_EDIT', msg: { id: 1, content: 'c' } });
      expect(editing.replyTo).toBeNull();
      expect(editing.editingMsg).toEqual({ id: 1, content: 'c' });
    });
    it('CLEAR_REPLY 只清回复', () => {
      const s = S({ replyTo: { id: 2 }, input: 'keep' });
      const n = composeReducer(s, { type: 'CLEAR_REPLY' });
      expect(n.replyTo).toBeNull();
      expect(n.input).toBe('keep');
    });
  });

  describe('发送与会话切换', () => {
    it('SENT：清输入 + 清回复，不动编辑态', () => {
      const s = S({ input: 'msg', replyTo: { id: 2 }, editingMsg: null });
      const n = composeReducer(s, { type: 'SENT' });
      expect(n.input).toBe('');
      expect(n.replyTo).toBeNull();
    });
    it('RESET：载入草稿 + 全清编辑/回复/语音', () => {
      const s = S({ input: 'old', voiceMode: true, editingMsg: { id: 1, content: 'c' }, replyTo: { id: 2 } });
      const n = composeReducer(s, { type: 'RESET', draft: '草稿' });
      expect(n).toEqual({ input: '草稿', voiceMode: false, editingMsg: null, replyTo: null });
    });
    it('RESET 无草稿 → 输入为空', () => {
      const n = composeReducer(S({ input: 'old' }), { type: 'RESET' });
      expect(n.input).toBe('');
    });
  });

  describe('不可变性', () => {
    it('不修改传入的 state 对象', () => {
      const s = S({ input: 'a' });
      const frozen = Object.freeze({ ...s });
      expect(() => composeReducer(frozen, { type: 'SET_INPUT', value: 'b' })).not.toThrow();
      expect(s.input).toBe('a');
    });
  });
});
