'use strict';
const A = require('../../shared/anchors');

/** 会话列表 + 聊天页对象。 */
class ChatPage {
  constructor(page) { this.page = page; }
  tid(id) { return this.page.locator(`[data-testid="${id}"]`); }

  /** 等主界面就绪(导航出现) */
  async waitReady() {
    await this.tid(A.navTab('chats')).first().waitFor({ state: 'visible', timeout: 15000 });
  }

  /**
   * 等 socket 真正连上(window.__vxinSocket.connected)。
   * 断网类用例必须先等连上再 setOffline(true),否则是「冷启动从未连上」而非
   * 「已连上后断线」——后者才是失败态/重连自愈路径的被测对象,前者会造成偶发 flaky。
   */
  async waitSocketConnected(timeout = 15000) {
    await this.page.waitForFunction(() => window.__vxinSocket?.connected === true, null, { timeout });
  }

  /** 按会话 id 打开;虚拟列表中不可见则先滚动 */
  async openConv(convId) {
    const item = this.tid(A.convItem(convId)).first();
    await item.scrollIntoViewIfNeeded().catch(() => {});
    await item.click();
    await this.tid(A.chatMsgInput).waitFor({ state: 'visible' });
  }

  /** 打开第一个会话(不关心是哪个) */
  async openFirstConv() {
    const items = this.page.locator('[data-testid^="conv-item-"]');
    await items.first().waitFor({ state: 'visible', timeout: 15000 });
    await items.first().click();
    await this.tid(A.chatMsgInput).waitFor({ state: 'visible' });
  }

  async sendText(text) {
    await this.tid(A.chatMsgInput).fill(text);
    await this.tid(A.chatSendBtn).click();
  }

  /** 只在输入框里打字、不发送(用于验证草稿保留) */
  async typeText(text) {
    await this.tid(A.chatMsgInput).fill(text);
  }

  /** 当前输入框内容 */
  async inputValue() {
    return this.tid(A.chatMsgInput).inputValue();
  }

  /** 某会话列表项上的「[草稿]」标记是否可见(testid 优先，回退到样式类) */
  async draftMarkVisible(convId) {
    return this.tid(A.convItem(convId))
      .locator(`[data-testid="${A.convItemDraft}"], .wc-chat-item-draft`)
      .first().isVisible().catch(() => false);
  }

  /** 把消息列表往上滚(离开底部)，触发「回到底部」按钮/新消息计数。默认滚到顶。
   * 用真实滚轮事件 + 直接置 scrollTop 双保险，并反复施加以对抗 react-window 的重排。 */
  async scrollMessagesUp(delta = null) {
    const outer = this.page.locator('.cw-msg-scroll').first();
    await outer.waitFor({ state: 'visible', timeout: 5000 });
    await outer.hover().catch(() => {});
    for (let i = 0; i < 3; i++) {
      await this.page.mouse.wheel(0, delta == null ? -4000 : delta).catch(() => {});
      await outer.evaluate((el, d) => {
        el.scrollTop = (d == null) ? 0 : Math.max(0, el.scrollTop + d);
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
      }, delta);
      await this.page.waitForTimeout(120);
    }
  }

  /** 读取消息滚动容器的度量(调试/断言可滚动性) */
  async scrollMetrics() {
    const outer = this.page.locator('.cw-msg-scroll').first();
    return outer.evaluate((el) => ({
      scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      distFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
    }));
  }

  /** 「回到底部」按钮是否可见 */
  async scrollBottomBtnVisible() {
    return this.tid(A.chatScrollBottom).isVisible().catch(() => false);
  }

  /** 「N 条新消息」角标文本(无则空串) */
  async newMsgBadgeText() {
    const b = this.tid(A.chatNewMsgBadge);
    return (await b.count()) ? (await b.first().innerText()).trim() : '';
  }

  /** 点「回到底部」按钮 */
  async clickScrollBottom() {
    await this.tid(A.chatScrollBottom).click();
  }

  /** 最新一条消息气泡 locator */
  lastBubble() {
    return this.page.locator('[data-testid^="msg-bubble-"]').last();
  }

  /** 断言某文本出现在某条气泡里 */
  async expectMessageVisible(text) {
    await this.page.locator('[data-testid^="msg-bubble-"]', { hasText: text }).last()
      .waitFor({ state: 'visible', timeout: 10000 });
  }

  /** 发图片:用隐藏 file input,绕系统弹窗 */
  async sendImage(filePath) {
    await this.tid(A.chatAttachImage).setInputFiles(filePath);
  }

  /** 发文件(>8MB 触发分片上传) */
  async sendFile(filePath) {
    await this.tid(A.chatAttachFile).setInputFiles(filePath);
  }

  /** 消息总数(气泡) */
  async bubbleCount() {
    return this.page.locator('[data-testid^="msg-bubble-"]').count();
  }

  /** 点击最后一张图片打开灯箱 */
  async openLastImageLightbox() {
    await this.tid(A.msgImage).last().click();
    await this.tid(A.lightbox).waitFor({ state: 'visible' });
  }

  /** 右键最后一条气泡弹出菜单 */
  async openCtxMenuOnLast() {
    await this.lastBubble().click({ button: 'right' });
  }

  /** 编辑最后一条自己发的消息 */
  async editLast(newText) {
    await this.openCtxMenuOnLast();
    await this.tid(A.ctxEdit).click();
    // 编辑态:输入框被填入原文,清空后输入新文本再发送
    const input = this.tid(A.chatMsgInput);
    await input.fill(newText);
    await this.tid(A.chatSendBtn).click();
  }

  /** 撤回最后一条自己发的消息(有确认弹窗) */
  async recallLast() {
    await this.openCtxMenuOnLast();
    await this.tid(A.ctxRecall).click();
    // 撤回有"确认撤回这条消息？"弹窗,点确认
    await this.tid(A.confirmOk).click();
  }

  /** 发起语音/视频通话,等通话窗出现 */
  async startCall(type = 'audio') {
    await this.tid(type === 'video' ? A.chatCallVideoBtn : A.chatCallAudioBtn).first().click();
    await this.tid(A.callModal).waitFor({ state: 'visible', timeout: 10000 });
  }

  async hangup() {
    await this.tid(A.callHangupBtn).click();
  }

  /** 灯箱:键盘翻页 / 关闭。返回当前大图 src */
  async lightboxImageSrc() {
    return this.tid(A.lightboxImage).first().getAttribute('src');
  }
  async lightboxNextByKey() { await this.page.keyboard.press('ArrowRight'); }
  async lightboxCloseByKey() { await this.page.keyboard.press('Escape'); }

  /** 已读状态文本(私聊"已读") */
  async readStatusVisible() {
    return this.tid(A.msgReadStatus).first().isVisible().catch(() => false);
  }

  /** 当前会话顶部未读红点数 / 列表项 */
  convItem(convId) { return this.tid(A.convItem(convId)); }

  // ── 群管理 ──
  /** 建群:开 + 菜单 → 发起群聊 → 填名 → 勾选成员 → 创建。返回创建后是否进入群会话 */
  async createGroup(name, memberIds) {
    await this.tid(A.addMenuBtn).first().click();
    await this.tid(A.createGroupEntry).click();
    await this.tid(A.groupNameInput).waitFor({ state: 'visible' });
    await this.tid(A.groupNameInput).fill(name);
    for (const uid of memberIds) {
      await this.tid(A.groupMemberRow(uid)).click();
    }
    await this.tid(A.groupCreateBtn).click();
    // 建群成功后进入群聊页(输入框出现)
    await this.tid(A.chatMsgInput).waitFor({ state: 'visible', timeout: 15000 });
  }

  /** 打开群信息面板 */
  async openGroupInfo() {
    await this.tid(A.groupInfoBtn).click();
  }

  /** 退出/解散群(群信息面板 → 退群或解散 → 确认)。
   * 群主看到的是"解散群聊"、普通成员看到的是"退出群聊"——两者都会把该会话移出列表，
   * 故按当前身份点存在的那个按钮（GRP-05 里 A 是建群者=群主，只有解散按钮）。 */
  async leaveGroup() {
    const leave = this.tid(A.groupLeaveBtn);
    const btn = (await leave.count()) ? leave : this.tid(A.groupDissolveBtn);
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click();
    await this.tid(A.confirmOk).click().catch(() => {});
  }

  // ── 账户 ──
  /** 在账户面板里添加第二个账号(登录并添加,不退当前) */
  async addAccount(phone, password) {
    await this.tid(A.accountSwitcher).click();
    await this.tid(A.accountAddRow).click();
    await this.tid(A.accountAddPhone).fill(phone);
    await this.tid(A.accountAddPassword).fill(password);
    await this.tid(A.accountAddSubmit).click();
  }

  /** 打开账户面板并切换到某账号 */
  async switchTo(accountId) {
    await this.tid(A.accountSwitcher).click();
    await this.tid(A.accountRow(accountId)).click();
  }
}

module.exports = { ChatPage };
