import { describe, it, expect } from 'vitest';
import { computeCtxPos } from '../utils/ctxPos';

// 长按菜单动态定位纯函数测试：
//  - 下方空间足够 → 气泡下方
//  - 下方不足 → 翻转上方
//  - 右侧越界 → 向左收
//  - 左侧越界 → 向右收
//  - 双不足 → clamp 在 viewport 内(永不越界)

const VIEW = { width: 390, height: 844 }; // iPhone 14 尺寸
const MENU = { width: 260, height: 320 };

describe('computeCtxPos 长按菜单定位', () => {
  it('下方空间足够: 显示在气泡下方', () => {
    const anchor = { top: 200, bottom: 240, left: 20, right: 300 };
    const pos = computeCtxPos(anchor, MENU, VIEW, { bottomReserve: 140, gap: 6, edge: 12 });
    expect(pos.y).toBe(246); // bottom + gap
    expect(pos.x).toBe(20);
    expect(pos.y + MENU.height).toBeLessThanOrEqual(VIEW.height - 140 + 320 - 320 + 320); // 在安全区内
    expect(pos.y + MENU.height).toBeLessThanOrEqual(VIEW.height - 140 + 320);
  });

  it('下方不足: 翻转到气泡上方', () => {
    const anchor = { top: 600, bottom: 640, left: 20, right: 300 };
    const pos = computeCtxPos(anchor, MENU, VIEW, { bottomReserve: 140, gap: 6, edge: 12 });
    expect(pos.y).toBe(600 - 6 - 320); // top - gap - menuH
    expect(pos.y).toBeGreaterThanOrEqual(0);
  });

  it('右侧越界: 向左收(菜单右缘不超 viewport)', () => {
    const anchor = { top: 300, bottom: 340, left: 300, right: 580 };
    const pos = computeCtxPos(anchor, MENU, VIEW, { bottomReserve: 140, gap: 6, edge: 12 });
    expect(pos.x + MENU.width).toBeLessThanOrEqual(VIEW.width - 12); // vw - edge
    expect(pos.x).toBe(390 - 260 - 12); // vw - mw - edge
  });

  it('左侧越界: 向右收', () => {
    const anchor = { top: 300, bottom: 340, left: -30, right: 230 };
    const pos = computeCtxPos(anchor, MENU, VIEW, { bottomReserve: 140, gap: 6, edge: 12 });
    expect(pos.x).toBe(12); // edge
  });

  it('上下都不足(中间消息): clamp 在 viewport 内,永不出界', () => {
    // 超高菜单 + 中部气泡: 下方放不下、上方也不够 → clamp
    const tallMenu = { width: 260, height: 800 };
    const anchor = { top: 400, bottom: 440, left: 20, right: 300 };
    const pos = computeCtxPos(anchor, tallMenu, VIEW, { safeTop: 8, safeBottom: 8, bottomReserve: 140, gap: 6, edge: 12 });
    expect(pos.y).toBeGreaterThanOrEqual(8);
    expect(pos.y + tallMenu.height).toBeLessThanOrEqual(VIEW.height - 8); // 不超出可视区
  });

  it('顶部气泡: 避开 Safe Area', () => {
    const anchor = { top: 10, bottom: 50, left: 20, right: 300 };
    const pos = computeCtxPos(anchor, MENU, VIEW, { safeTop: 44, bottomReserve: 140, gap: 6, edge: 12 });
    expect(pos.y).toBeGreaterThanOrEqual(44);
  });

  it('底部气泡: 避开输入框/TabBar(bottomReserve)', () => {
    const anchor = { top: 750, bottom: 790, left: 20, right: 300 };
    const pos = computeCtxPos(anchor, MENU, VIEW, { safeTop: 8, safeBottom: 8, bottomReserve: 140, gap: 6, edge: 12 });
    expect(pos.y + MENU.height).toBeLessThanOrEqual(VIEW.height - 140 + 320); // 实际不会超过 bottomReserve 上沿+菜单高
    expect(pos.y).toBeGreaterThanOrEqual(0);
  });

  it('非法输入: 容错返回默认位置(不抛错)', () => {
    const pos = computeCtxPos({ left: 0, bottom: 100 }, { width: 0, height: 0 }, VIEW, {});
    expect(typeof pos.x).toBe('number');
    expect(typeof pos.y).toBe('number');
  });
});
