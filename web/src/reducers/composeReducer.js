// ── ChatWindow 输入区（compose）状态 reducer ──────────────────────────
// 纯函数：收敛此前散落在多处的「input / voiceMode / editingMsg / replyTo」
// 协同 setState。把「开始编辑=载入文本+进编辑态+清回复」「设回复=清编辑」
// 「发送后=清文本+清回复」「切换会话=全清」等多字段转换收敛为单个原子
// action，杜绝「改了一个忘了另一个」的不一致 bug。
//
// 注意：recording 由 MediaRecorder 副作用驱动、绑定 recorderRef，不属于纯
// 状态协同，故不纳入本 reducer。
//
// state 形状：
//   { input: string, mode: 'TEXT'|'KEYBOARD'|'VOICE'|'EMOJI'|'MORE', emojiTab: 'emoji'|'stickers',
//     editingMsg: {id,content}|null, replyTo: object|null }

export const initialComposeState = {
  input: '',
  mode: 'TEXT',
  emojiTab: 'emoji',
  editingMsg: null,
  suspendedDraft: null,
  replyTo: null,
  fromDraft: false, // 当前输入是否从草稿恢复（用于显示"草稿"提示）
};

export const MAX_COMPOSE_LENGTH = 30000;
const boundedInput = value => {
  const text = value.slice(0, MAX_COMPOSE_LENGTH);
  // UTF-16 limits must not leave half of an emoji at the boundary.
  return /[\uD800-\uDBFF]$/.test(text) ? text.slice(0, -1) : text;
};
export function insertComposeText(input, text, start = input.length, end = start) {
  const from = Math.max(0, Math.min(start, input.length));
  const to = Math.max(from, Math.min(end, input.length));
  const available = MAX_COMPOSE_LENGTH - (input.length - (to - from));
  // A picker insertion is atomic: keep the draft unchanged when it cannot fit.
  if (text.length > available) return { value: input, caret: from };
  return { value: input.slice(0, from) + text + input.slice(to), caret: from + text.length };
}
const restoreDraft = state => ({ ...state, editingMsg: null, suspendedDraft: null,
  input: state.suspendedDraft?.input || '', replyTo: state.suspendedDraft?.replyTo || null,
  fromDraft: state.suspendedDraft?.fromDraft || false });

export function composeReducer(state, action) {
  switch (action.type) {
    // 输入文本变化（onChange）
    case 'SET_INPUT':
      return { ...state, input: boundedInput(action.value), fromDraft: false };

    // 追加文本（emoji 选择器插入等），基于当前值
    case 'APPEND_INPUT':
      return { ...state, input: insertComposeText(state.input, action.text).value, fromDraft: false };

    case 'INSERT_INPUT':
      return { ...state, input: insertComposeText(state.input, action.text, action.start, action.end).value, fromDraft: false };

    // @提及插入后替换为完整文本
    case 'REPLACE_INPUT':
      return { ...state, input: boundedInput(action.value), fromDraft: false };

    // 语音/文字输入模式切换
    case 'TOGGLE_VOICE':
      return { ...state, mode: state.mode === 'VOICE' ? 'KEYBOARD' : 'VOICE' };

    case 'TOGGLE_PANEL': {
      const mode = action.panel === 'more' ? 'MORE' : 'EMOJI';
      const same = state.mode === mode && (mode !== 'EMOJI' || state.emojiTab === action.panel);
      return { ...state, mode: same ? 'KEYBOARD' : mode, emojiTab: mode === 'EMOJI' ? action.panel : state.emojiTab };
    }
    case 'CLOSE_PANEL':
      return ['EMOJI', 'MORE'].includes(state.mode) ? { ...state, mode: 'TEXT' } : state;
    case 'FOCUS_INPUT':
      return { ...state, mode: 'KEYBOARD' };
    case 'BLUR_INPUT':
      return state.mode === 'KEYBOARD' ? { ...state, mode: 'TEXT' } : state;

    // 开始编辑：载入原文 + 进入编辑态 + 清除回复（编辑与回复互斥）
    case 'START_EDIT':
      return {
        ...state,
        mode: 'KEYBOARD',
        editingMsg: { id: action.msg.id, content: action.msg.content },
        suspendedDraft: state.editingMsg ? state.suspendedDraft : { input: state.input, replyTo: state.replyTo, fromDraft: state.fromDraft },
        input: action.msg.content,
        replyTo: null,
      };

    // Leaving an edit restores the composition it temporarily replaced.
    case 'CANCEL_EDIT':
      return state.editingMsg ? restoreDraft(state) : state;

    case 'EDIT_SAVED':
      return state.editingMsg === action.editor && state.input.replace(/\r\n?/g, '\n').trim() === action.content
        ? restoreDraft(state) : state;

    // 设置回复对象：进入回复态 + 清除编辑（互斥）
    case 'SET_REPLY':
      return { ...(state.editingMsg ? restoreDraft(state) : state), replyTo: action.msg, mode: 'KEYBOARD' };

    // 清除回复
    case 'CLEAR_REPLY':
      return { ...state, replyTo: null };

    // 消息发送成功后：清空输入 + 清除回复（编辑态由 CANCEL_EDIT 单独处理）
    case 'SENT':
      return { ...state, input: '', replyTo: null, fromDraft: false };

    case 'CONSUMED_DRAFT':
      return !state.editingMsg && state.input === action.content
        ? { ...state, input: '', replyTo: null, fromDraft: false } : state;

    // 切换会话：载入草稿 + 退出语音模式 + 清编辑/回复（全清，避免跨会话残留）
    case 'RESET':
      return {
        ...initialComposeState,
        input: action.draft || '',
        fromDraft: !!action.draft,
      };

    default:
      return state;
  }
}
