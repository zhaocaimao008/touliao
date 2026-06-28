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

    # ── 编辑/撤回(移动端长按消息弹菜单) ──
    def long_press_last_bubble(self):
        """长按最后一条气泡弹出操作菜单(Android/iOS 通用手势)"""
        from selenium.webdriver.common.actions.action_builder import ActionBuilder
        from selenium.webdriver.common.actions.pointer_input import PointerInput
        bubbles = self.d.find_elements(self._by(), A.MSG_BUBBLE("") )  # 注:实际用 startswith,见 README
        # 简化:对最后一个可见气泡长按。具体定位策略按工程实际调整。
        el = bubbles[-1] if bubbles else None
        if not el:
            return
        actions = ActionBuilder(self.d, mouse=PointerInput("touch", "finger"))
        rect = el.rect
        x, y = rect["x"] + rect["width"] // 2, rect["y"] + rect["height"] // 2
        actions.pointer_action.move_to_location(x, y).pointer_down().pause(1.0).pointer_up()
        actions.perform()

    def edit_last(self, new_text):
        self.long_press_last_bubble()
        self.wait(A.CTX_EDIT).click()
        inp = self.el(A.CHAT_MSG_INPUT)
        inp.clear()
        inp.send_keys(new_text)
        self.el(A.CHAT_SEND_BTN).click()

    def recall_last(self):
        self.long_press_last_bubble()
        self.wait(A.CTX_RECALL).click()
        if self.exists(A.CONFIRM_OK):
            self.el(A.CONFIRM_OK).click()

    # ── 通话(仅 UI/signaling) ──
    def start_call(self, kind="audio"):
        tid = A.CHAT_CALL_VIDEO_BTN if kind == "video" else A.CHAT_CALL_AUDIO_BTN
        self.el(tid).click()
        self.wait(A.CALL_MODAL)

    def hangup(self):
        self.el(A.CALL_HANGUP_BTN).click()
