"""账户切换 + 网络异常用例。android/ios 共用。"""
import time
import pytest
from pages import App


@pytest.fixture
def app(driver, request):
    return App(driver, request.config.getoption("--platform"))


def test_acc_01_add_account(app, seeded):
    """ACC-01 添加第二账号 → 不被登出,账号列表 2 个"""
    A, B = seeded["users"][0], seeded["users"][1]
    app.login(A["phone"], A["password"])
    app.wait_main()
    app.add_account(B["phone"], B["password"])
    time.sleep(2)
    # 仍在主界面(未被登出)
    assert app.exists("nav-tab-chats") or not app.exists("login-phone-input")


def test_net_01_offline_send(app, seeded):
    """NET-01 断网发消息 → 发送失败态(Android)。iOS 模拟器网络切换受限,见 README。"""
    if not seeded["convAB"]:
        pytest.skip("无会话")
    if app.platform != "android":
        pytest.skip("iOS 模拟器网络切换受限")
    A = seeded["users"][0]
    app.login(A["phone"], A["password"])
    app.wait_main()
    app.open_conv(seeded["convAB"])
    app.set_network(False)
    app.send_text(f"net-{int(time.time())}")
    assert app.exists("msg-send-failed")
    app.set_network(True)
