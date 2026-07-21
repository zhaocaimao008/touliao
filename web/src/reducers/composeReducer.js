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
//   { input: string, voiceMode: boolean,
//     editingMsg: {id,content}|null, replyTo: object|null }

export const initialComposeState = {
  input: '',
  voiceMode: false,
  editingMsg: null,
  replyTo: null,
};

export function composeReducer(state, action) {
  switch (action.type) {
    // 输入文本变化（onChange）
    case 'SET_INPUT':
      return { ...state, input: action.value };

    // 追加文本（emoji 选择器插入等），基于当前值
    case 'APPEND_INPUT':
      return { ...state, input: state.input + action.text };

    // @提及插入后替换为完整文本
    case 'REPLACE_INPUT':
      return { ...state, input: action.value };

    // 语音/文字输入模式切换
    case 'TOGGLE_VOICE':
      return { ...state, voiceMode: !state.voiceMode };

    // 开始编辑：载入原文 + 进入编辑态 + 清除回复（编辑与回复互斥）
    case 'START_EDIT':
      return {
        ...state,
        editingMsg: { id: action.msg.id, content: action.msg.content },
        input: action.msg.content,
        replyTo: null,
      };

    // 取消编辑：退出编辑态 + 清空输入
    case 'CANCEL_EDIT':
      return { ...state, editingMsg: null, input: '' };

    // 设置回复对象：进入回复态 + 清除编辑（互斥）
    case 'SET_REPLY':
      return { ...state, replyTo: action.msg, editingMsg: null };

    // 清除回复
    case 'CLEAR_REPLY':
      return { ...state, replyTo: null };

    // 消息发送成功后：清空输入 + 清除回复（编辑态由 CANCEL_EDIT 单独处理）
    case 'SENT':
      return { ...state, input: '', replyTo: null };

    // 切换会话：载入草稿 + 退出语音模式 + 清编辑/回复（全清，避免跨会话残留）
    case 'RESET':
      return {
        ...initialComposeState,
        input: action.draft || '',
      };

    default:
      return state;
  }
}
