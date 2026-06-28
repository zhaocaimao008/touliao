"""
Appium 测试公共 fixtures。
 - backend: 起隔离 backend-v2(复用 shared/env 的端口/邀请码),造号,关 CSRF/限流
 - seeded: 造好的账号 + A↔B 会话(convAB)
 - driver: Appium 会话(Android/iOS 由 --platform 决定)

后端连接说明(移动端访问宿主机):
 - Android 模拟器: http://10.0.2.2:3099  (10.0.2.2 = 宿主 localhost)
 - iOS 模拟器:    http://127.0.0.1:3099
 在 App 登录页"切换服务器"填上述地址,或在测试里注入。
"""
import json
import os
import subprocess
import time
import socket
import pytest
import requests

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BACKEND_DIR = os.path.join(REPO_ROOT, "backend-v2")
PORT = int(os.environ.get("E2E_BACKEND_PORT", "3099"))
INVITE = os.environ.get("E2E_INVITE_CODE", "123456")
JWT = os.environ.get("E2E_JWT_SECRET", "e2e-test-secret-12345")
DB = os.environ.get("E2E_DB_PATH", "/tmp/vxin-e2e-appium.db")
PASSWORD = "e2epass1234"
BASE = f"http://127.0.0.1:{PORT}"


def _wait_health(timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if requests.get(BASE + "/health", timeout=1.5).status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(0.4)
    return False


@pytest.fixture(scope="session")
def backend():
    try:
        os.remove(DB)
    except OSError:
        pass
    env = dict(os.environ, DB_PATH=DB, PORT_V2=str(PORT), INVITE_CODE=INVITE,
               JWT_SECRET=JWT, APP_URL=BASE, NODE_ENV="test",
               DISABLE_RATE_LIMIT="1", DISABLE_CSRF="1")
    proc = subprocess.Popen(["node", "src/server.js"], cwd=BACKEND_DIR, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert _wait_health(), "backend 未就绪"
    yield BASE
    proc.terminate()
    try:
        proc.wait(timeout=3)
    except Exception:
        proc.kill()


def _register(username, phone):
    r = requests.post(BASE + "/api/auth/register",
                      json={"username": username, "phone": phone, "password": PASSWORD, "inviteCode": INVITE},
                      timeout=8)
    r.raise_for_status()
    d = r.json()
    return {"username": d["user"]["username"], "phone": phone, "password": PASSWORD,
            "token": d["token"], "id": d["user"]["id"]}


def _auth(method, path, token, body=None):
    r = requests.request(method, BASE + path, headers={"Authorization": f"Bearer {token}"},
                         json=body, timeout=8)
    r.raise_for_status()
    return r.json() if r.text else {}


@pytest.fixture(scope="session")
def seeded(backend):
    pid = os.getpid() % 100000
    users = [_register(f"AliceE2E", f"1{pid:05d}00001"),
             _register(f"BobE2E", f"1{pid:05d}00002")]
    # A↔B 好友 + 私聊会话
    conv_ab = None
    try:
        _auth("POST", "/api/users/friend-request", users[0]["token"], {"toId": users[1]["id"]})
        reqs = _auth("GET", "/api/users/friend-requests", users[1]["token"])
        lst = reqs if isinstance(reqs, list) else reqs.get("requests", [])
        if lst:
            _auth("POST", f"/api/users/friend-request/{lst[0]['id']}/handle", users[1]["token"], {"action": "accepted"})
        conv = _auth("POST", "/api/messages/conversation/private", users[0]["token"], {"userId": users[1]["id"]})
        conv_ab = conv.get("id") or conv.get("conversationId")
    except Exception as e:
        print("建会话失败:", e)
    return {"users": users, "convAB": conv_ab, "backendUrl": BASE}


def pytest_addoption(parser):
    parser.addoption("--platform", action="store", default="android", choices=["android", "ios"])
    parser.addoption("--app", action="store", default=os.environ.get("E2E_APP", ""),
                     help="APK(android) 或 .app(ios) 路径")


@pytest.fixture(scope="session")
def driver(request):
    from appium import webdriver
    from appium.options.android import UiAutomator2Options
    from appium.options.ios import XCUITestOptions

    platform = request.config.getoption("--platform")
    app = request.config.getoption("--app")
    server = os.environ.get("APPIUM_SERVER", "http://127.0.0.1:4723")

    if platform == "android":
        opts = UiAutomator2Options()
        opts.platform_name = "Android"
        opts.automation_name = "UiAutomator2"
        opts.app_package = "com.vxin.app"
        opts.app_activity = "com.vxin.app.MainActivity"
        if app:
            opts.app = app
        opts.auto_grant_permissions = True
        opts.new_command_timeout = 120
    else:
        opts = XCUITestOptions()
        opts.platform_name = "iOS"
        opts.automation_name = "XCUITest"
        opts.device_name = os.environ.get("IOS_DEVICE", "iPhone 15")
        opts.platform_version = os.environ.get("IOS_VERSION", "17.0")
        if app:
            opts.app = app
        opts.auto_accept_alerts = True

    drv = webdriver.Remote(server, options=opts)
    drv.implicitly_wait(10)
    yield drv
    drv.quit()
