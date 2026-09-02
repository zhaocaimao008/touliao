import { describe, expect, it, vi } from 'vitest';
import { applySyncEvents, catchUpConversation } from './messageSync';

describe('message cursor sync', () => {
  it('orders, deduplicates, edits and removes append-only events', () => {
    const events = [
      { server_sequence: 3, event_type: 'message_edited', message_id: 'a', payload: { content: 'edited' } },
      { server_sequence: 1, event_type: 'message_created', message_id: 'a', message: { id: 'a', content: 'old', server_sequence: 1 } },
      { server_sequence: 2, event_type: 'message_created', message_id: 'b', message: { id: 'b', content: 'b', server_sequence: 2 } },
      { server_sequence: 4, event_type: 'message_recalled', message_id: 'b' },
      { server_sequence: 1, event_type: 'message_created', message_id: 'a', message: { id: 'a', content: 'old', server_sequence: 1 } },
    ];
    expect(applySyncEvents([], events)).toEqual([{ id: 'a', content: 'edited', server_sequence: 1, edited: 1 }]);
  });

  it('continues until has_more is false and persists each page cursor', async () => {
    const pages = [
      { next_cursor: 500, has_more: true, messages: [] },
      { next_cursor: 1000, has_more: false, messages: [] },
    ];
    const saveCursor = vi.fn();
    const finalCursor = await catchUpConversation({
      conversationId: 'c', accountId: 'u', loadCursor: async () => 0,
      saveCursor, applyPage: async () => {}, requestPage: async () => pages.shift(),
    });
    expect(finalCursor).toBe(1000);
    expect(saveCursor.mock.calls.map(call => call[2])).toEqual([500, 1000]);
  });
});

// ── 2026-09-02 审计（472863a 二分插入）补充用例 ──────────────────────────
// 用例 1/2 为设计期望行为（应绿）；用例 3/4 断言「正确行为」用于证明
// 洞 A（中间 pending 导致二分错位）/ 洞 B（就地更新不重定位）真实存在（应红）。
// pending 消息 = 无 server_sequence 的本地乐观占位（Web 实际形态：id=_tempId, 无 seq）。
describe('applySyncEvents pending 有序性（审计用例）', () => {
  it('尾部 pending 保持位置：新消息按 seq 插到 pending 之后（设计语义，应绿）', () => {
    const current = [
      { id: 'm1', server_sequence: 1 },
      { id: 'm2', server_sequence: 2 },
      { id: 'tmp1', _tempId: 'tmp1' }, // 无 seq 的本地 pending（当场发送失败，贴尾）
    ];
    const events = [{
      server_sequence: 3, event_type: 'message_created', message_id: 'm3',
      message: { id: 'm3', server_sequence: 3 },
    }];
    const result = applySyncEvents(current, events);
    expect(result.map(m => m.id)).toEqual(['m1', 'm2', 'tmp1', 'm3']); // pending 槽位不漂移
  });

  it('乐观占位替换：client_msg_id 命中的本地占位被删除、真实消息按 seq 插入，无双显（应绿）', () => {
    const current = [
      { id: 'm1', server_sequence: 1 },
      { id: 'tmp1', _tempId: 'tmp1', content: 'hi', _status: 'sending' },
    ];
    const events = [{
      server_sequence: 2, event_type: 'message_created', message_id: 'real1',
      message: { id: 'real1', client_msg_id: 'tmp1', server_sequence: 2, content: 'hi' },
    }];
    const result = applySyncEvents(current, events);
    const ids = result.map(m => m.id);
    expect(ids).toEqual(['m1', 'real1']);
    expect(ids.filter(id => id === 'tmp1')).toHaveLength(0); // 无双显
  });

  it('洞 A：中间 pending 使二分插错位——seq1.5 应落在 m1/m2 之间，实际会落到 pending 之后（应红）', () => {
    // 场景：outbox created_at 混排把 pending 锚到数组中间（客户端时钟 vs 服务端时钟偏差）
    const current = [
      { id: 'm1', server_sequence: 1 },
      { id: 'm2', server_sequence: 2 },
      { id: 'tmp1', _tempId: 'tmp1' }, // pending 卡在 m2 与 m3 之间（seq 视作 0）
      { id: 'm3', server_sequence: 3 },
    ];
    const events = [{
      server_sequence: 1.5, event_type: 'message_created', message_id: 'new15',
      message: { id: 'new15', server_sequence: 1.5 },
    }];
    const result = applySyncEvents(current, events);
    // 正确行为：数组（忽略 pending）按 seq 非降 → new15 必须在 m1 与 m2 之间
    expect(result.map(m => m.id)).toEqual(['m1', 'new15', 'm2', 'tmp1', 'm3']);
  });

  it('洞 B：已错位的真实消息被同 id 事件再确认时只就地更新、不重定位——断言应自愈为有序（应红）', () => {
    // 模拟重发确认后带最新 seq 的真实消息卡在 pending 旧槽位（洞 A 造成错位 + ack 就地替换不重定位）
    // 后续广播/补拉的 message_created（同 message_id）应把顺序修正回 seq 非降
    const current = [
      { id: 'm1', server_sequence: 1 },
      { id: 'm3', server_sequence: 3 }, // m3 已被错放到 m1 与 m2 之间
      { id: 'm2', server_sequence: 2 },
    ];
    const events = [{
      server_sequence: 3, event_type: 'message_created', message_id: 'm3',
      message: { id: 'm3', server_sequence: 3, content: 'confirmed' },
    }];
    const result = applySyncEvents(current, events);
    // 正确行为：同 id 再确认应把 m3 放回 seq 序正确位置
    expect(result.map(m => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('dev 断言：插入前数组真实消息乱序 → 降级全量排序修复（证明断言在 test 模式真实启用）', () => {
    // 本用例在 vitest(MODE=test) 下：insertBySeq 前内联条件为真 → assertSortedOrRepair 检测
    // 乱序(m3 在 m2 前) → console.error + 降级排序 → 新消息按序插入。
    // 若断言被误判关闭(如条件折叠错误/误用 DEV),m4 会 push 到乱序数组末尾 → 本用例变红。
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const current = [
      { id: 'm1', server_sequence: 1 },
      { id: 'm3', server_sequence: 3 }, // 乱序
      { id: 'm2', server_sequence: 2 },
    ];
    const events = [{
      server_sequence: 4, event_type: 'message_created', message_id: 'm4',
      message: { id: 'm4', server_sequence: 4 },
    }];
    const result = applySyncEvents(current, events);
    expect(spy).toHaveBeenCalled(); // 断言必须真的触发过(而非静默跳过)
    spy.mockRestore();
    expect(result.map(m => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });
});
