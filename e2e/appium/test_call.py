"""通话用例(CALL-01/02,仅 UI/signaling,不验媒体流)。android/ios 共用。
注:模拟器需授予麦克风/摄像头权限(conftest 的 autoGrantPermissions/autoAcceptAlerts)。
真实媒体协商不在自动化范围。
"""
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


def test_call_01_audio(app, seeded):
    """CALL-01 发起语音通话 → 通话窗出现 → 挂断"""
    if not seeded["convAB"]:
        pytest.skip("无会话")
    _login_open(app, seeded)
    app.start_call("audio")
    assert app.exists("call-modal")
    app.hangup()


def test_call_02_video(app, seeded):
    """CALL-02 发起视频通话 → 通话窗出现"""
    if not seeded["convAB"]:
        pytest.skip("无会话")
    _login_open(app, seeded)
    app.start_call("video")
    assert app.exists("call-modal")
