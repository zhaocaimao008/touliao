'use strict';
const A = require('../../shared/anchors');

/** 登录/注册页对象。锚点全部来自 shared/anchors.js。 */
class LoginPage {
  constructor(page) { this.page = page; }

  tid(id) { return this.page.locator(`[data-testid="${id}"]`); }

  // web=BrowserRouter(/login),electron=HashRouter(/#/login)。hash 传 true 用后者。
  async gotoLogin(baseURL, { hash = false } = {}) {
    await this.page.goto(baseURL + (hash ? '/#/login' : '/login'));
    await this.tid(A.loginPhone).waitFor({ state: 'visible' });
  }

  async login(phone, password) {
    await this.tid(A.loginPhone).fill(phone);
    await this.tid(A.loginPassword).fill(password);
    await this.tid(A.loginSubmit).click();
  }

  async errorText() {
    return (await this.tid(A.authError).textContent())?.trim() || '';
  }
}

module.exports = { LoginPage };
