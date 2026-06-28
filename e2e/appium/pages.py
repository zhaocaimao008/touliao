"""移动端 POM。锚点来自 anchors.py(四端统一)。
定位策略:
 - Android: AppiumBy.ID(依赖 testTagsAsResourceId=true,见 MainActivity)
 - iOS:     AppiumBy.ACCESSIBILITY_ID
by() 按平台自动选。
"""
from appium.webdriver.common.appiumby import AppiumBy
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import anchors as A


class App:
    def __init__(self, driver, platform):
        self.d = driver
        self.platform = platform

    def _by(self):
        return AppiumBy.ID if self.platform == "android" else AppiumBy.ACCESSIBILITY_ID

    def el(self, tid):
        return self.d.find_element(self._by(), tid)

    def wait(self, tid, timeout=15):
        return WebDriverWait(self.d, timeout).until(
            EC.presence_of_element_located((self._by(), tid)))

    def exists(self, tid):
        return len(self.d.find_elements(self._by(), tid)) > 0

    # ── 认证 ──
    def login(self, phone, password):
        self.wait(A.LOGIN_PHONE)
        self.el(A.LOGIN_PHONE).send_keys(phone)
        self.el(A.LOGIN_PASSWORD).send_keys(password)
        self.el(A.LOGIN_SUBMIT).click()

    def wait_main(self):
        self.wait(A.NAV_TAB("chats"))

    def error_text(self):
        return self.el(A.AUTH_ERROR).text if self.exists(A.AUTH_ERROR) else ""

    # ── 会话/聊天 ──
    def open_conv(self, conv_id):
        self.wait(A.CONV_ITEM(conv_id)).click()
        self.wait(A.CHAT_MSG_INPUT)

    def send_text(self, text):
        self.el(A.CHAT_MSG_INPUT).send_keys(text)
        self.el(A.CHAT_SEND_BTN).click()

    def message_visible(self, text, timeout=10):
        # 简化:断言含 text 的元素出现(移动端按文本)
        WebDriverWait(self.d, timeout).until(
            lambda d: any(text in (e.text or "") for e in d.find_elements(
                AppiumBy.XPATH, "//*[contains(@text,'') or @label]")))

    # ── 导航 ──
    def switch_tab(self, key):
        self.el(A.NAV_TAB(key)).click()
