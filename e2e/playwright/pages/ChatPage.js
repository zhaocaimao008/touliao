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
}

module.exports = { ChatPage };
