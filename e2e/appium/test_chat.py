"""单聊用例(CHAT)。android/ios 共用。"""
import time
import pytest
from pages import App


@pytest.fixture
def app(driver, request):
    a = App(driver, request.config.getoption("--platform"))
    return a


def _login_open(app, seeded):
    u = seeded["users"][0]
    app.login(u["phone"], u["password"])
    app.wait_main()
    if seeded["convAB"]:
        app.open_conv(seeded["convAB"])
    return seeded["convAB"]


def test_chat_02_send_text(app, seeded):
    """CHAT-02 发送文本 → 气泡出现"""
    if not seeded["convAB"]:
        pytest.skip("无会话")
    _login_open(app, seeded)
    text = f"appium-e2e-{int(time.time())}"
    app.send_text(text)
    app.message_visible(text)


# CHAT-05/06/07(图片/文件/语音): [M] 需注入素材到沙盒
@pytest.mark.skip(reason="[M] 图片/文件需 driver.push_file 注入沙盒,见 README")
def test_chat_05_send_image(app, seeded):
    pass
