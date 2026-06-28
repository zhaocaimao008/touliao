"""编辑/撤回用例(CHAT-08/09)。android/ios 共用,--platform 切。
移动端通过长按气泡弹菜单(long_press_last_bubble)。锚点 ctx-edit/ctx-recall 已就位。
"""
import time
import pytest
from pages import App


@pytest.fixture
def app(driver, request):
    return App(driver, request.config.getoption("--platform"))


def _login_open(app, seeded):
    u = seeded["users"][0]
    app.login(u["phone"], u["password"])
    app.wait_main()
    app.open_conv(seeded["convAB"])


def test_chat_08_edit(app, seeded):
    """CHAT-08 编辑消息 → 显示已编辑"""
    if not seeded["convAB"]:
        pytest.skip("无会话")
    _login_open(app, seeded)
    app.send_text(f"edit-{int(time.time())}")
    new = f"edited-{int(time.time())}"
    app.edit_last(new)
    app.message_visible(new)
    assert app.exists("msg-edited-flag")


def test_chat_09_recall(app, seeded):
    """CHAT-09 撤回消息 → 撤回提示"""
    if not seeded["convAB"]:
        pytest.skip("无会话")
    _login_open(app, seeded)
    app.send_text(f"recall-{int(time.time())}")
    app.recall_last()
    assert app.exists("msg-recalled")
