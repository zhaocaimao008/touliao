"""
移动端边界/异常/性能用例 (EDGE-A 系列)。
Android + iOS 共用,按平台选跳过条件。

运行:
  pytest test_edge.py --platform=android --app=../../android/.../app-debug.apk -v
  pytest test_edge.py --platform=ios    --app=../../ios/.../Vxin.app -v
"""
import os
import time
import pytest
import requests
from pages import App

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "fixtures")


@pytest.fixture
def app(driver, request):
    return App(driver, request.config.getoption("--platform"))


def _login_open(app, seeded):
    u = seeded["users"][0]
    app.login(u["phone"], u["password"])
    app.wait_main()
    if seeded["convAB"]:
        app.open_conv(seeded["convAB"])


# ─────────────────────────────────────────────────────────
# EDGE-A01  断网期间收消息 → 恢复后补拉
# Android only:set_network_connection 可靠切换;iOS 模拟器受限。
# ─────────────────────────────────────────────────────────
def test_edge_a01_offline_recv_catchup(app, seeded, backend):
    """断网期间对端发消息 → 恢复网络后 App 自动补拉,消息出现"""
    if not seeded["convAB"]:
        pytest.skip("无会话")
    if app.platform != "android":
        pytest.skip("iOS 模拟器 set_network_connection 不可靠,改用真机或手动测")

    B = seeded["users"][1]
    _login_open(app, seeded)

    # A 断网
    app.set_network(False)
    time.sleep(1)

    # 断网期间 B 通过 REST 发一条消息(模拟对端在线)
    missed = f"missed-{int(time.time())}"
    resp = requests.post(
        backend + f"/api/messages/{seeded['convAB']}",
        headers={"Authorization": f"Bearer {B['token']}"},
        json={"content": missed, "type": "text"},
        timeout=8,
    )
    assert resp.ok, f"B 发消息失败: {resp.text}"
    time.sleep(1.5)

    # A 恢复网络 → socket 重连 + 补拉
    app.set_network(True)
    # 补拉超时 20s
    app.message_visible(missed, timeout=20)


# ─────────────────────────────────────────────────────────
# EDGE-A02  并发快发 5 条 → 全部到达且不重复
# ─────────────────────────────────────────────────────────
def test_edge_a02_concurrent_send_no_dup(app, seeded):
    """连续快发 5 条(不等 ack),最终每条恰好 1 次(clientMsgId 幂等)"""
    if not seeded["convAB"]:
        pytest.skip("无会话")
    _login_open(app, seeded)

    tag = f"conc-{int(time.time())}"
    before = app.bubble_count()
    for i in range(5):
        inp = app.el("chat-msg-input")
        inp.send_keys(f"{tag}-{i}")
        app.el("chat-send-btn").click()
        # 不等 ack,立即下一条(模拟手速)

    # 等待 5 条全部出现(共 10s 内)
    for i in range(5):
        app.message_visible(f"{tag}-{i}", timeout=12)

    # 总气泡数 = before + 5(不丢不重)
    deadline = time.time() + 8
    while time.time() < deadline:
        count = app.bubble_count()
        if count >= before + 5:
            break
        time.sleep(0.5)
    assert app.bubble_count() == before + 5, "气泡数不对:有丢失或重复"

    # 每条文本恰好出现 1 次
    for i in range(5):
        assert app.message_count_by_text(f"{tag}-{i}") == 1, f"第{i}条重复或丢失"


# ─────────────────────────────────────────────────────────
# EDGE-A03  push_file 注入图片 → 发送图片气泡  [M]
# 需要真机/模拟器文件系统可访问,Android API 29+ AOSP 文件选择器。
# ─────────────────────────────────────────────────────────
@pytest.mark.skipif(
    not os.path.exists(os.path.join(FIXTURES, "sample.png")),
    reason="e2e/fixtures/sample.png 不存在"
)
def test_edge_a03_push_file_send_image(app, seeded):
    """push_file 注入图片到设备 → 通过 attach 按钮发送 → msg-image 气泡出现"""
    if not seeded["convAB"]:
        pytest.skip("无会话")
    _login_open(app, seeded)
    image_path = os.path.join(FIXTURES, "sample.png")
    app.push_and_send_image(image_path)
    # msg-image 锚点已在 MessageItem 里绑定
    app.testid_visible("msg-image", timeout=20)


# ─────────────────────────────────────────────────────────
# EDGE-A04  超长消息(4000 字) → 正常渲染不崩
# ─────────────────────────────────────────────────────────
def test_edge_a04_long_message(app, seeded):
    """发送 4000 字超长消息 → App 不崩,输入框仍可用"""
    if not seeded["convAB"]:
        pytest.skip("无会话")
    _login_open(app, seeded)

    long_text = "长" * 3998 + f"-{int(time.time())}"  # 4000 字符
    app.send_text(long_text)

    # 等消息出现(取前 10 字检测)
    app.message_visible(long_text[:10], timeout=15)
    # App 没崩:输入框仍在
    assert app.exists("chat-msg-input", timeout=5), "发超长消息后输入框消失(可能崩溃)"


# ─────────────────────────────────────────────────────────
# EDGE-A05  切后台 → 停 15s → 回前台 → 消息仍在
# ─────────────────────────────────────────────────────────
def test_edge_a05_background_resume(app, seeded):
    """发一条消息 → App 压后台 15s → 唤回 → 消息仍在界面"""
    if not seeded["convAB"]:
        pytest.skip("无会话")
    _login_open(app, seeded)

    mark = f"bg-{int(time.time())}"
    app.send_text(mark)
    app.message_visible(mark, timeout=10)

    # 压后台 15s(background_app 自动唤回)
    app.go_background(seconds=15)
    # Appium background_app(N) 等 N 秒后自动唤回,之后测试继续

    # 确认回前台后消息仍在
    app.message_visible(mark, timeout=10)
    assert app.exists("chat-msg-input", timeout=5), "回前台后聊天页不可用"


# ─────────────────────────────────────────────────────────
# EDGE-A06  长时间通话保活(60s 无操作 → 通话窗仍在 → 挂断)
# 需要麦克风权限(conftest autoGrantPermissions/autoAcceptAlerts)。
# ─────────────────────────────────────────────────────────
def test_edge_a06_call_keepalive_60s(app, seeded):
    """发起语音通话 → 等 60s 不操作 → 通话窗仍在(未自动断开) → 挂断"""
    if not seeded["convAB"]:
        pytest.skip("无会话")
    _login_open(app, seeded)

    app.start_call("audio")
    assert app.exists("call-modal", timeout=10), "通话窗未出现"

    # 60s 内每 10s 检查一次通话窗仍在
    for _ in range(6):
        time.sleep(10)
        assert app.exists("call-modal", timeout=3), "通话窗在 60s 内意外消失(保活失败)"

    # 手动挂断
    app.hangup()
    # 通话窗关闭
    deadline = time.time() + 10
    while time.time() < deadline:
        if not app.exists("call-modal", timeout=1):
            break
    assert not app.exists("call-modal", timeout=2), "挂断后通话窗未关闭"


# ─────────────────────────────────────────────────────────
# EDGE-A07  回复消息 → 气泡含 msg-reply-preview 锚点
# ─────────────────────────────────────────────────────────
def test_edge_a07_reply_preview(app, seeded):
    """发一条消息 → 长按回复 → 新气泡含 reply-preview 锚点"""
    if not seeded["convAB"]:
        pytest.skip("无会话")
    _login_open(app, seeded)

    original = f"orig-{int(time.time())}"
    app.send_text(original)
    app.message_visible(original, timeout=10)

    reply_text = f"reply-{int(time.time())}"
    app.reply_to_last(reply_text)

    # 等回复消息出现
    app.message_visible(reply_text, timeout=10)
    # msg-reply-preview 锚点出现(引用预览)
    assert app.exists("msg-reply-preview", timeout=8), "回复气泡中未见 msg-reply-preview"


# ─────────────────────────────────────────────────────────
# EDGE-A08  特殊字符 / HTML / XSS → 原样显示,不执行脚本
# ─────────────────────────────────────────────────────────
def test_edge_a08_special_chars_no_xss(app, seeded):
    """发含 HTML/XSS payload 的消息 → 界面原样文本显示,不崩溃"""
    if not seeded["convAB"]:
        pytest.skip("无会话")
    _login_open(app, seeded)

    payload = f'<script>alert(1)</script>&"\'😀—{int(time.time())}'
    app.send_text(payload)

    # 移动端原生渲染不走 innerHTML,只需确认消息出现且 App 不崩
    app.message_visible("<script>", timeout=10)  # 标签文本原样出现
    assert app.exists("chat-msg-input", timeout=5), "发特殊字符后 App 可能崩溃"
