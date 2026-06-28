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
}

module.exports = { ChatPage };
