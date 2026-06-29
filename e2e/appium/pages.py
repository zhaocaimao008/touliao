"""移动端 POM。锚点来自 anchors.py(四端统一)。
定位策略:
 - Android: AppiumBy.ID(依赖 testTagsAsResourceId=true,见 MainActivity)
 - iOS:     AppiumBy.ACCESSIBILITY_ID
by() 按平台自动选。
"""
import base64
import os
import time as _time

from appium.webdriver.common.appiumby import AppiumBy
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import anchors as A

# Android 系统文件选择器(DocumentsUI AOSP,API 29+)常见 ID
_DOCS_PKG = "com.android.documentsui"
_DOCS_DRAWER_OPEN = f"{_DOCS_PKG}:id/drawer_layout"


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

    def exists(self, tid, timeout=3):
        try:
            WebDriverWait(self.d, timeout).until(
                EC.presence_of_element_located((self._by(), tid)))
            return True
        except Exception:
            return False

    # ── 认证 ──
    def login(self, phone, password):
        self.wait(A.LOGIN_PHONE)
        self.el(A.LOGIN_PHONE).send_keys(phone)
        self.el(A.LOGIN_PASSWORD).send_keys(password)
        self.el(A.LOGIN_SUBMIT).click()

    def wait_main(self, timeout=20):
        self.wait(A.NAV_TAB("chats"), timeout)

    def error_text(self):
        return self.el(A.AUTH_ERROR).text if self.exists(A.AUTH_ERROR) else ""

    # ── 会话/聊天 ──
    def open_conv(self, conv_id):
        self.wait(A.CONV_ITEM(conv_id)).click()
        self.wait(A.CHAT_MSG_INPUT)

    def send_text(self, text):
        self.el(A.CHAT_MSG_INPUT).send_keys(text)
        self.el(A.CHAT_SEND_BTN).click()

    def bubble_count(self):
        """返回当前聊天页可见气泡数量(按 testid 前缀)"""
        xpath = (
            "//*[starts-with(@resource-id,'msg-bubble-')]"
            if self.platform == "android"
            else "//*[starts-with(@name,'msg-bubble-')]"
        )
        return len(self.d.find_elements(AppiumBy.XPATH, xpath))

    def message_visible(self, text, timeout=10):
        """等待界面上出现包含 text 的文本元素"""
        if self.platform == "android":
            xpath = f'//*[contains(@text,"{text}")]'
        else:
            xpath = f'//*[@value="{text}" or @label="{text}" or contains(@label,"{text}")]'
        WebDriverWait(self.d, timeout).until(
            lambda d: len(d.find_elements(AppiumBy.XPATH, xpath)) > 0,
            message=f"文本未出现: {text[:60]}"
        )

    def message_count_by_text(self, text):
        """返回界面上包含 text 的气泡数量(用于检测重复)"""
        if self.platform == "android":
            xpath = f'//*[contains(@text,"{text}")]'
        else:
            xpath = f'//*[contains(@label,"{text}") or contains(@value,"{text}")]'
        return len(self.d.find_elements(AppiumBy.XPATH, xpath))

    def testid_visible(self, tid, timeout=15):
        """等待某 testid 元素出现"""
        return self.wait(tid, timeout)

    # ── 导航 ──
    def switch_tab(self, key):
        self.el(A.NAV_TAB(key)).click()

    # ── 后台/前台(切 App) ──
    def go_background(self, seconds=0):
        """将 App 压到后台;seconds>0 则等待后自动唤回(Appium background_app)"""
        if seconds > 0:
            self.d.background_app(seconds)  # Appium 2.x: 压后台并自动回来
        else:
            self.d.background_app(-1)       # 压后台不自动唤回

    def come_foreground(self):
        """从后台唤回 App(仅 Android)"""
        if self.platform == "android":
            pkg = self.d.capabilities.get("appPackage", "com.vxin.app")
            self.d.activate_app(pkg)
        # iOS 无需调用;background_app 的定时版本已自动唤回

    # ── 编辑/撤回(移动端长按消息弹菜单) ──
    def _all_bubbles(self):
        """按 testid 前缀找所有气泡元素"""
        if self.platform == "android":
            return self.d.find_elements(
                AppiumBy.XPATH, "//*[starts-with(@resource-id,'msg-bubble-')]")
        else:
            return self.d.find_elements(
                AppiumBy.XPATH, "//*[starts-with(@name,'msg-bubble-')]")

    def long_press_last_bubble(self):
        """长按最后一条气泡弹出操作菜单"""
        from selenium.webdriver.common.actions.action_builder import ActionBuilder
        from selenium.webdriver.common.actions.pointer_input import PointerInput
        bubbles = self._all_bubbles()
        if not bubbles:
            raise RuntimeError("没有找到气泡元素")
        el = bubbles[-1]
        actions = ActionBuilder(self.d, mouse=PointerInput("touch", "finger"))
        rect = el.rect
        x = rect["x"] + rect["width"] // 2
        y = rect["y"] + rect["height"] // 2
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

    def reply_to_last(self, reply_text):
        """长按最后一条气泡 → 回复 → 发送 reply_text"""
        self.long_press_last_bubble()
        self.wait(A.CTX_REPLY).click()
        self.wait(A.CHAT_MSG_INPUT)
        self.el(A.CHAT_MSG_INPUT).send_keys(reply_text)
        self.el(A.CHAT_SEND_BTN).click()

    # ── 图片/文件发送(push_file 注入沙盒) ──
    def push_and_send_image(self, local_path):
        """
        Android: push_file 到 /sdcard/Download/,扫描 MediaStore,
                 触发附件按钮后在系统选择器里选中该文件。
        iOS:     push_file 到 app 沙盒 /private/var/mobile/...,
                 触发 UIImagePickerController 后选取。
        成功后等待 msg-image 锚点出现。
        """
        filename = os.path.basename(local_path)
        with open(local_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()

        if self.platform == "android":
            remote = f"/sdcard/Download/{filename}"
            self.d.push_file(remote, b64)
            # 通知 MediaScanner
            self.d.execute_script("mobile: shell", {
                "command": "am",
                "args": ["broadcast", "-a",
                         "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
                         "-d", f"file://{remote}"]
            })
            _time.sleep(1)
            self.el(A.CHAT_ATTACH_IMAGE).click()
            # AOSP DocumentsUI: 左抽屉 → Downloads → 选文件
            _time.sleep(1.5)
            try:
                # 侧边栏"Downloads"
                drawer = self.d.find_elements(
                    AppiumBy.XPATH,
                    '//*[@text="Downloads" or @text="下载" or @content-desc="Downloads"]')
                if drawer:
                    drawer[0].click()
                    _time.sleep(0.8)
                # 按文件名点击
                file_el = self.d.find_element(
                    AppiumBy.XPATH, f'//*[@text="{filename}"]')
                file_el.click()
            except Exception as e:
                raise RuntimeError(f"系统文件选择器操作失败({e}),请手动选取 {filename}")
        else:
            # iOS: push 到 App 的 Documents(xcuitest 支持 pushFile 到沙盒)
            bundle = self.d.capabilities.get("bundleId", "com.vxin.app")
            remote = f"@{bundle}/Documents/{filename}"
            self.d.push_file(remote, b64)
            self.el(A.CHAT_ATTACH_IMAGE).click()
            _time.sleep(1)
            # PHPickerViewController / UIImagePickerController 按文件名选取
            try:
                self.d.find_element(
                    AppiumBy.XPATH, f'//*[@label="{filename}" or @value="{filename}"]').click()
            except Exception as e:
                raise RuntimeError(f"iOS 系统图库选取失败({e}),请手动选取 {filename}")

        # 等待图片气泡出现
        self.wait(A.MSG_IMAGE, timeout=20)

    # ── 通话(仅 UI/signaling) ──
    def start_call(self, kind="audio"):
        tid = A.CHAT_CALL_VIDEO_BTN if kind == "video" else A.CHAT_CALL_AUDIO_BTN
        self.el(tid).click()
        self.wait(A.CALL_MODAL)

    def hangup(self):
        self.el(A.CALL_HANGUP_BTN).click()

    # ── 群管理 ──
    def create_group(self, name, member_ids):
        self.el(A.ADD_MENU_BTN).click()
        self.wait(A.CREATE_GROUP_ENTRY).click()
        self.wait(A.GROUP_NAME_INPUT).send_keys(name)
        for uid in member_ids:
            self.el(A.GROUP_MEMBER_ROW(uid)).click()
        self.el(A.GROUP_CREATE_BTN).click()
        self.wait(A.CHAT_MSG_INPUT)

    def open_group_info(self):
        self.el(A.GROUP_INFO_BTN).click()

    def leave_group(self):
        self.wait(A.GROUP_LEAVE_BTN).click()
        if self.exists(A.CONFIRM_OK):
            self.el(A.CONFIRM_OK).click()

    # ── 账户 ──
    def add_account(self, phone, password):
        self.el(A.ACCOUNT_SWITCHER).click()
        self.wait(A.ACCOUNT_ADD_ROW).click()
        self.el(A.ACCOUNT_ADD_PHONE).send_keys(phone)
        self.el(A.ACCOUNT_ADD_PASSWORD).send_keys(password)
        self.el(A.ACCOUNT_ADD_SUBMIT).click()

    def switch_to(self, account_id):
        self.el(A.ACCOUNT_SWITCHER).click()
        self.wait(A.ACCOUNT_ROW(account_id)).click()

    # ── 网络(移动端用 driver 切网络) ──
    def set_network(self, enabled):
        """Android: set_network_connection;iOS 模拟器有限,降级为不操作(README 说明)"""
        if self.platform == "android":
            # 6 = wifi+data, 1 = airplane(off)
            try:
                self.d.set_network_connection(6 if enabled else 1)
            except Exception:
                pass

    def wait_network_reconnect(self, timeout=15):
        """等待 socket 重连:轮询直到 chat-msg-input 可用(断网期间通常不可发送)"""
        end = _time.time() + timeout
        while _time.time() < end:
            if self.exists(A.CHAT_MSG_INPUT, timeout=2):
                return True
            _time.sleep(1)
        return False
