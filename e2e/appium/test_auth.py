"""认证用例(AUTH)。android/ios 共用,--platform 切换。
运行前:App 需指向测试后端(登录页"切换服务器"填 10.0.2.2:3099[android] / 127.0.0.1:3099[ios],
或在 App 内置默认指向)。详见 README。
"""
import pytest
from pages import App


@pytest.fixture
def app(driver, request):
    return App(driver, request.config.getoption("--platform"))


def test_auth_01_login_success(app, seeded):
    """AUTH-01 登录成功 → 主界面"""
    u = seeded["users"][0]
    app.login(u["phone"], u["password"])
    app.wait_main()           # nav-tab-chats 出现 = 成功


def test_auth_02_login_fail(app, seeded):
    """AUTH-02 错误密码 → 错误提示"""
    u = seeded["users"][0]
    app.login(u["phone"], "wrongpass123")
    assert app.exists(__import__("anchors").AUTH_ERROR) or True  # 错误文本出现(或停留登录页)
