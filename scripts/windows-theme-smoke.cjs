// Windows typography and theme regression, using isolated API/WebSocket fixtures.
// CHROMIUM_CHANNEL=chrome uses the Windows runner's installed Chrome and native fonts.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    "../desktop-electron/node_modules/playwright",
);
const { fixture } = require("./windows-ui-smoke.cjs");
const root = path.resolve(
  process.env.UI_BUILD || path.join(__dirname, "../web/dist"),
);
const out = path.resolve(
  process.env.UI_OUTPUT || path.join(__dirname, "../artifacts/windows-themes"),
);
fs.mkdirSync(out, { recursive: true });
const report = {
  nativeHost: process.platform,
  renderer: "Chromium",
  apiFixtures: true,
  cases: [],
  fonts: [],
};
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webp": "image/webp",
};
const server = http.createServer((req, res) => {
  const relative =
    decodeURIComponent(new URL(req.url, "http://localhost").pathname).replace(
      /^\/+/,
      "",
    ) || "index.html";
  const file = path.resolve(root, relative);
  if (
    !file.startsWith(root + path.sep) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    "Content-Type",
    mime[path.extname(file)] || "application/octet-stream",
  );
  fs.createReadStream(file).pipe(res);
});
async function inspect(page) {
  return page.evaluate((critical) => {
    // Canvas resolves CSS Color 4 (including color-mix) to actual sRGB bytes.
    const swatch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgb = (s) => {
      swatch.clearRect(0, 0, 1, 1);
      swatch.fillStyle = s;
      swatch.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = swatch.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (a, b) => [
      ...a.slice(0, 3).map((v, i) => v * a[3] + b[i] * (1 - a[3])),
      1,
    ];
    const lum = (c) =>
      c
        .slice(0, 3)
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const contrast = (a, b) => {
      const x = lum(a),
        y = lum(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const visible = (e) => {
      const r = e.getBoundingClientRect(),
        s = getComputedStyle(e);
      return (
        r.width &&
        r.height &&
        r.bottom > 0 &&
        r.y < innerHeight &&
        s.visibility !== "hidden" &&
        s.display !== "none"
      );
    };
    const color = (e) => {
      const parents = [];
      for (let p = e; p; p = p.parentElement) parents.unshift(p);
      let bg = [255, 255, 255, 1],
        gradient = false,
        opacity = 1;
      for (const p of parents) {
        const s = getComputedStyle(p);
        bg = over(rgb(s.backgroundColor), bg);
        gradient ||= s.backgroundImage !== "none";
        opacity *= Number(s.opacity);
      }
      return { bg, gradient, opacity };
    };
    const list = [],
      walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode,
        e = n.parentElement,
        text = n.textContent.trim();
      if (!text || !e || !visible(e) || ["STYLE", "SCRIPT"].includes(e.tagName))
        continue;
      const range = document.createRange();
      range.selectNode(n);
      if (
        ![...range.getClientRects()].some(
          (r) =>
            r.height &&
            r.width &&
            r.bottom > 30 &&
            r.y < innerHeight &&
            r.right > 0 &&
            r.x < innerWidth,
        )
      )
        continue;
      const s = getComputedStyle(e),
        { bg, gradient, opacity } = color(e),
        fg = rgb(s.color);
      fg[3] *= opacity;
      list.push({
        critical: !!e.closest(critical),
        text: text.slice(0, 65),
        selector:
          e.tagName.toLowerCase() +
          "." +
          String(e.className).trim().replace(/\s+/g, "."),
        color: s.color,
        bg: bg.slice(0, 3).map(Math.round),
        size: s.fontSize,
        font: s.fontFamily,
        weight: s.fontWeight,
        lineHeight: s.lineHeight,
        contrast: gradient
          ? null
          : Math.round(contrast(over(fg, bg), bg) * 100) / 100,
        gradient,
        disabled: !!e.closest(":disabled"),
        avatar: !!e.closest(
          ".wc-chat-item-avatar,.wc-msg-avatar,.as-avatar,.wc-contact-avatar,.wc-me-avatar,.wc-sidebar-avatar",
        ),
      });
    }
    const fields = [...document.querySelectorAll("input,textarea")]
      .filter((e) => visible(e) && !e.disabled)
      .flatMap((e) => {
        const text = e.value || e.placeholder;
        if (!text) return [];
        const st = getComputedStyle(e, e.value ? null : "::placeholder"),
          { bg, gradient, opacity } = color(e),
          fg = rgb(st.color);
        fg[3] *= opacity * Number(st.opacity);
        return [
          {
            text,
            selector: e.className,
            placeholder: !e.value,
            contrast: gradient
              ? null
              : Math.round(contrast(over(fg, bg), bg) * 100) / 100,
          },
        ];
      });
    const icons = [
      ...document.querySelectorAll(
        ".wc-voice-play-icon,.wc-voice-play-icon-offset",
      ),
    ]
      .filter(visible)
      .map((e) => {
        const { bg } = color(e);
        return {
          selector: e.getAttribute("class"),
          contrast: contrast(over(rgb(getComputedStyle(e).fill), bg), bg),
        };
      });
    const read = (selector) => {
      const e = document.querySelector(selector);
      if (!e) return null;
      const s = getComputedStyle(e);
      return {
        font: s.fontFamily,
        size: s.fontSize,
        lineHeight: s.lineHeight,
        color: s.color,
        background: s.backgroundColor,
      };
    };
    return {
      theme: document.body.className,
      skin: document.body.dataset.skin,
      viewport: [innerWidth, innerHeight],
      overflow: document.documentElement.scrollWidth > innerWidth,
      texts: list,
      fields,
      icons,
      styles: Object.fromEntries(
        [
          "body",
          ".wc-msg-bubble.mine",
          ".wc-msg-bubble.other",
          ".wc-textarea",
          ".wc-chat-item-name",
          ".wc-chat-item-preview",
          ".wc-font-demo",
          ".auth-field-input",
        ].map((s) => [s, read(s)]),
      ),
    };
  }, critical);
}

const critical =
  ".wc-sidebar-label,.wc-sidebar-badge,.wc-chat-item-name,.wc-chat-item-preview,.wc-chat-item-time,.wc-chat-item-draft,.wc-msg-bubble,.wc-msg-time,.wc-msg-read,.wc-send-btn,.wc-page-header-back,.wc-crow-label,.wc-crow-desc,.wc-crow-value,.profile-appearance-label,.wc-font-preview,.wc-font-label,.profile-font-demo-text,.auth-link,.auth-field-label,.auth-submit,.auth-footer,.fwd-tab,.fwd-preview-label,.fwd-footer-count,.fwd-btn,.wc-ctx-item,.wc-logout-btn,.wc-save-btn,.wc-shortcut-label,.wc-shortcut-hint,.profile-shortcut-label,.profile-shortcut-desc,.wc-contact-item-name,.wc-contact-item-sub,.req-name,.req-msg,.req-accept,.req-reject,.up-name,.up-sub,.gi-label,.gi-meta,.gi-name,.gi-sec-tit,.gi-mg-label,.gi-mg-desc,.gs-name,.gs-sub,.wc-moment-name,.wc-moment-text,.wc-moment-time,.wc-moment-action-btn,.wc-moment-editor-publish,.wc-moment-comment-submit,.tl-collection-card,.tl-collection-filters,.wc-device-name,.wc-device-info,.wc-badge-current,.chatfiles-info-name,.chatfiles-info-meta,.tl-call-log,.auth-note,.wc-upload-bar,.wc-net-banner,.wc-toast";
async function check(page, name, errors, { screenshot = true } = {}) {
  await page.waitForTimeout(220);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      if (Number.isFinite(animation.effect?.getComputedTiming().endTime))
        animation.finish();
    }
  });
  assert.deepEqual(errors, [], name + ": renderer errors");
  const result = await inspect(page);
  result.name = name;
  assert.equal(result.overflow, false, name + ": document overflow");
  const measured = result.texts.filter(
    (t) => t.critical && !t.disabled && !t.avatar,
  );
  assert.ok(measured.length > 0, name + ": critical text must be measured");
  assert.ok(
    result.icons.every((icon) => icon.contrast >= 3),
    name + ": voice control contrast",
  );
  const failures = measured.filter(
    (t) => t.contrast !== null && t.contrast < 4.5,
  );
  result.contrastFailures = failures;
  const fieldFailures = result.fields.filter(
    (f) => f.contrast !== null && f.contrast < 4.5,
  );
  result.fieldFailures = fieldFailures;
  report.cases.push(result);
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  if (screenshot)
    await page.screenshot({
      path: path.join(out, name + ".png"),
      animations: "disabled",
    });
  assert.deepEqual(failures, [], name + ": text contrast below 4.5:1");
  assert.deepEqual(
    fieldFailures,
    [],
    name + ": input or placeholder contrast below 4.5:1",
  );
  const metrics = await page.evaluate(() => ({
    rows: [...document.querySelectorAll(".wc-chat-item")].map((e) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    }),
    bubble: [...document.querySelectorAll(".wc-msg-bubble.mine")]
      .filter(
        (e) =>
          !e.querySelector(
            ".wc-msg-img,.wc-msg-video,.wc-msg-sticker,.wc-redpacket-card,.wc-contact-card",
          ),
      )
      .map((e) => getComputedStyle(e).backgroundImage),
    scrollbars: [...document.querySelectorAll(".wc-list *")].filter(
      (e) =>
        e.clientWidth > 0 &&
        e.scrollWidth > e.clientWidth &&
        ["auto", "scroll"].includes(getComputedStyle(e).overflowX),
    ).length,
    draft: document.querySelector(".wc-textarea")
      ? getComputedStyle(document.querySelector(".wc-textarea")).fontSize
      : null,
    message: document.querySelector(".wc-msg-bubble")
      ? getComputedStyle(document.querySelector(".wc-msg-bubble")).fontSize
      : null,
  }));
  for (let i = 0; i < metrics.rows.length; i++) {
    assert.equal(metrics.rows[i].height, require('../web/src/ui-kit/tokens.json').components.listRow.desktopMinimum);
    if (i)
      assert.ok(
        metrics.rows[i - 1].bottom <= metrics.rows[i].top + 0.5,
        name + ": rows overlap",
      );
  }
  assert.equal(metrics.scrollbars, 0, name + ": list horizontal scrollbar");
  for (const background of metrics.bubble)
    assert.equal(background, "none", name + ": unexpected bubble gradient");
  if (metrics.draft && metrics.message)
    assert.equal(
      metrics.draft,
      metrics.message,
      name + ": input font must follow message font",
    );
  console.log("PASS", name);
}
async function fonts(page, name) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument");
    for (const selector of [
      ".wc-chat-item-name",
      ".wc-msg-bubble.other",
      ".wc-textarea",
    ]) {
      const { nodeId } = await session.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector,
      });
      if (nodeId) {
        const data = await session.send("CSS.getPlatformFontsForNode", {
          nodeId,
        });
        report.fonts.push({ name, selector, fonts: data.fonts });
      }
    }
  } finally {
    await session.detach();
  }
}
async function chat(page) {
  await page.getByTestId("conv-item-ui-0").click();
  await page.locator(".wc-msg-bubble").first().waitFor();
}
async function appearance(page) {
  await page.getByTestId("nav-tab-me").click();
  await page.getByText("外观", { exact: true }).click();
  await page.locator(".wc-appearance-btn").first().waitFor();
}
async function run() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : process.env.CHROMIUM_CHANNEL
        ? { channel: process.env.CHROMIUM_CHANNEL }
        : {}),
  });
  try {
    for (const skin of ["touliao", "aurora", "wechat", "wecom"])
      for (const theme of ["light", "dark"]) {
        const { context, page, errors } = await fixture(browser, base, {
          skin,
          theme,
        });
        page.setDefaultTimeout(15000);
        const prefix = `${skin}-${theme}`;
        await chat(page);
        await page
          .getByTestId("chat-msg-input")
          .fill("中文与 English 123，标点和数字 ABC");
        await check(page, prefix + "-chat", errors);
        if (skin === "aurora") await fonts(page, prefix);
        await page.getByTestId("msg-bubble-msg-1").click({ button: "right" });
        await page.getByTestId("ctx-forward").waitFor();
        await check(page, prefix + "-menu", errors);
        await page.getByTestId("ctx-forward").click();
        await page.locator(".fwd-panel").waitFor();
        await page.locator(".fwd-item").first().click();
        await check(page, prefix + "-forward", errors);
        await page.locator(".fwd-hd-close").click();
        await page.getByTestId("nav-tab-contacts").click();
        await page.getByText("新的朋友", { exact: true }).waitFor();
        await check(page, prefix + "-contacts", errors);
        await page.getByTestId("nav-tab-me").click();
        await page.locator(".wc-me-header").waitFor();
        await check(page, prefix + "-profile", errors);
        if (skin === "aurora")
          for (const [label, key] of [
            ["设备管理", "devices"],
            ["隐私与安全", "privacy"],
            ["修改密码", "password"],
            ["通知", "notifications"],
            ["服务器地址", "server"],
            ["快捷键设置", "shortcuts"],
          ]) {
            await page.getByText(label, { exact: true }).click();
            await page.locator(".wc-page-header-title").waitFor();
            await check(page, prefix + "-" + key, errors);
            await page.locator(".wc-page-header-back").click();
            await page.locator(".wc-me-header").waitFor();
          }
        await page.getByText("外观", { exact: true }).click();
        await page.locator(".wc-appearance-btn").first().waitFor();
        await check(page, prefix + "-appearance", errors);
        for (const [label, size] of [
          ["小", 12],
          ["标准", 14],
          ["大", 16],
          ["特大", 18],
        ]) {
          await page.getByText(label, { exact: true }).click();
          assert.equal(
            await page
              .locator(".profile-font-demo-text")
              .evaluate((e) => getComputedStyle(e).fontSize),
            size + "px",
          );
        }
        await page.getByTestId("nav-tab-chats").click();
        await chat(page);
        await page
          .getByTestId("chat-msg-input")
          .fill("放大后的中文、Aa 123 与消息字号一致");
        await page.setViewportSize({ width: 900, height: 600 });
        await check(page, prefix + "-xlarge-900", errors);
        await context.close();
        const login = await fixture(browser, base, {
          skin,
          theme,
          authenticated: false,
          width: 900,
          height: 600,
        });
        login.page.setDefaultTimeout(15000);
        await login.page.getByTestId("login-phone-input").fill("13800000000");
        await login.page
          .getByTestId("login-password-input")
          .fill("fixture-password");
        await check(login.page, prefix + "-login-900", login.errors);
        const b = await login.page
          .getByTestId("login-switch-server-toggle")
          .boundingBox();
        assert.ok(
          b.y + b.height <= 600,
          prefix + ": minimum login actions fit",
        );
        if (skin === "aurora") {
          await login.page.locator('a[href="#/register"]').click();
          await login.page.getByTestId("register-username-input").waitFor();
          for (const [key, value] of [
            ["username", "界面测试"],
            ["phone", "13800000000"],
            ["password", "Fixture123"],
            ["invite", "123456"],
          ])
            await login.page.getByTestId(`register-${key}-input`).fill(value);
          await login.page
            .getByTestId("register-submit-btn")
            .scrollIntoViewIfNeeded();
          await check(login.page, prefix + "-register", login.errors);
          await login.page.locator('a[href="#/login"]').click();
          await login.page.locator('a[href="#/forgot-password"]').click();
          await login.page.locator(".auth-note").waitFor();
          await check(login.page, prefix + "-forgot", login.errors);
        }
        await login.context.close();
        // Exercise links, quoted text, edited labels, files and voice captions inside bubbles.
        const rich = await fixture(browser, base, { skin, theme });
        rich.page.setDefaultTimeout(15000);
        const now = Math.floor(Date.now() / 1000);
        const messages = [
          {
            id: "rich-other",
            sender_id: "peer-0",
            type: "text",
            content: "中文 Aa 123：正文、引文和文件保持一致。",
          },
          {
            id: "rich-text",
            sender_id: "ui-me",
            type: "text",
            content: "参考资料 https://example.com/review?font=中文&size=18",
            edited: true,
            replyTo: {
              id: "rich-other",
              senderName: "林晓",
              type: "text",
              content: "需要确认的文字层级与夜间颜色",
            },
          },
          {
            id: "rich-file",
            sender_id: "ui-me",
            type: "file",
            content: "Windows 字体与界面检查 2026.pdf",
            file_url: base + "/fixture.pdf",
            file_size: 128000,
            file_mime: "application/pdf",
          },
          {
            id: "rich-voice",
            sender_id: "ui-me",
            type: "voice",
            content: "18",
            duration: 18,
            file_url: base + "/fixture.ogg",
          },
        ].map((m, i) => ({
          ...m,
          conversation_id: "ui-0",
          senderName: m.sender_id === "ui-me" ? "界面体验" : "林晓",
          created_at: now - 80 + i * 10,
        }));
        await rich.context.route("**/api/messages/ui-0*", (route) =>
          route.fulfill({ json: messages }),
        );
        await chat(rich.page);
        await check(rich.page, prefix + "-rich-messages", rich.errors);
        await rich.context.close();
      }
    // Pixel-density rendering at Windows-relevant scales; this is not an OS DPI test.
    for (const theme of ["light", "dark"])
      for (const scale of [1, 1.25, 1.5]) {
        const scaled = {
          newContext: (options) =>
            browser.newContext({ ...options, deviceScaleFactor: scale }),
        };
        const f = await fixture(scaled, base, {
          theme,
          width: 1000,
          height: 700,
        });
        f.page.setDefaultTimeout(15000);
        await chat(f.page);
        await check(f.page, `${theme}-density-${scale}`, f.errors);
        await f.context.close();
      }
    const auto = await fixture(browser, base, { theme: "auto" });
    auto.page.setDefaultTimeout(15000);
    await appearance(auto.page);
    for (const scheme of ["dark", "light"]) {
      await auto.page.emulateMedia({ colorScheme: scheme });
      await auto.page.waitForFunction(
        (dark) => document.body.classList.contains("dark-mode") === dark,
        scheme === "dark",
      );
      await check(auto.page, "system-" + scheme, auto.errors);
    }
    await auto.page.getByText("夜间模式", { exact: true }).click();
    await auto.page.waitForFunction(() =>
      document.body.classList.contains("dark-mode"),
    );
    await auto.page.emulateMedia({ colorScheme: "light" });
    assert.equal(
      await auto.page.evaluate(() =>
        document.body.classList.contains("dark-mode"),
      ),
      true,
      "manual dark selection overrides system light",
    );
    await auto.context.close();
    report.passed = true;
  } finally {
    await browser.close();
    server.close();
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
}
if (require.main === module) run().catch((error) => {
  server.close();
  console.error(error);
  process.exitCode = 1;
});

module.exports = { inspect };
