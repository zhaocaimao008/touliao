"""
API Client — 封装 requests.Session，自动处理 Cookie + CSRF 双提交。
每个测试用户对应一个 VxinSession 实例，保持独立 Cookie Jar。

认证策略（两种，优先直签 Token 以绕过限流）：
  1. direct_auth(user_dict): 用 JWT_SECRET 直接签 Token，不调用登录 API（推荐用于测试）
  2. login(phone, password):  走正常登录 API（受 IP 限流约束）
"""
import os
import re
from pathlib import Path
import time
import uuid
import jwt as pyjwt
import requests

BASE_URL    = os.getenv("VXIN_BASE_URL", "http://localhost:3002")
JWT_SECRET  = os.getenv(
    "VXIN_JWT_SECRET",
    "3ee56dae629a3bfbc1f406f0be0a26abe62b69452f41a9af4e5df1b82d96e613c4e85bed66c025b4356df6e0a8adc3413a4d8744d6038dbb527047787d43c58d",
)
TOKEN_MAX_AGE = 30 * 24 * 3600  # 30天（与服务端一致）


class VxinSession:
    """
    封装单个用户的 HTTP 会话：
    - login() 后自动从 Set-Cookie 提取 csrf_token，注入 X-CSRF-Token 请求头
    - 所有后续请求复用同一 requests.Session（保持 Cookie）
    """

    def __init__(self, base_url: str = BASE_URL):
        self.base_url = base_url
        self._s = requests.Session()
        self._s.verify = False          # 本地测试跳过 TLS 校验
        self.user = None                # 登录成功后填充

    # ── 认证 ──────────────────────────────────────────────────────

    # ── 直签 Token（绕过登录限流）─────────────────────────────────

    def direct_auth(self, user: dict) -> "VxinSession":
        """
        用 JWT_SECRET 直接签发 Token，植入 Session Cookie Jar，
        再调用 GET /api/auth/me 触发 auth 中间件下发 csrf_token。
        完全绕过登录 API 和 IP 速率限制，适合测试 Setup。
        """
        csrf_val = str(uuid.uuid4())
        payload  = {
            "id":       user["id"],
            "username": user["username"],
            "csrf":     csrf_val,
            "exp":      int(time.time()) + TOKEN_MAX_AGE,
        }
        token = pyjwt.encode(payload, JWT_SECRET, algorithm="HS256")

        # 直接写入 Cookie Jar（不指定 domain/path，对所有请求生效）
        self._s.cookies["vxin_token"] = token

        # 预热 CSRF：auth 中间件读 JWT，将 jwt.csrf 写入 csrf_token Cookie
        me = self._s.get(f"{self.base_url}/api/auth/me")
        assert me.status_code == 200, (
            f"direct_auth 预热失败 [{me.status_code}]: {me.text}\n"
            f"user={user['username']}"
        )
        self.user = me.json()

        # 同步 CSRF header
        csrf = self._s.cookies.get("csrf_token")
        if csrf:
            self._s.headers["X-CSRF-Token"] = csrf

        return self

    def _csrf_sync_hook(self, resp, *args, **kwargs):
        """
        响应钩子：每次收到响应后，如果 csrf_token Cookie 有更新，
        则同步 X-CSRF-Token 请求头。
        auth 中间件在每个认证响应中下发 csrf_token Cookie，
        此钩子保证 header 始终与 Cookie Jar 中的值一致。
        """
        csrf = self._s.cookies.get("csrf_token")
        if csrf:
            self._s.headers["X-CSRF-Token"] = csrf

    def login(self, phone: str, password: str) -> "VxinSession":
        # Explicit consent for synthetic test accounts; use the repository policy source.
        source = Path(__file__).resolve().parents[3] / "backend-v2/src/modules/legal/documents.js"
        version = re.search(r"const version = '([^']+)'", source.read_text()).group(1)
        legal_consent = {"accepted": True, "privacyVersion": version, "termsVersion": version}
        resp = self._s.post(
            f"{self.base_url}/api/auth/login",
            json={"phone": phone, "password": password, "legalConsent": legal_consent},
        )
        assert resp.status_code == 200, (
            f"登录失败 [{resp.status_code}]: {resp.text}"
        )
        self.user = resp.json().get("user", {})

        # login 控制器只设 vxin_token（httpOnly），不设 csrf_token。
        # 首个 auth 中间件保护的请求会触发 csrf_token 下发。
        # 主动 GET /me 预热 CSRF，避免第一个 POST 因无 CSRF header 被拒。
        me_resp = self._s.get(f"{self.base_url}/api/auth/me")
        if me_resp.status_code == 200 and not self.user:
            self.user = me_resp.json()
        # 此时 csrf_token Cookie 已在 CookieJar 中，同步到 header
        csrf = self._s.cookies.get("csrf_token")
        if csrf:
            self._s.headers["X-CSRF-Token"] = csrf

        return self

    def logout(self):
        self._s.post(f"{self.base_url}/api/auth/logout")
        self._s.cookies.clear()
        self._s.headers.pop("X-CSRF-Token", None)
        self.user = None

    # ── HTTP 动词代理 ──────────────────────────────────────────────

    def get(self, path: str, **kw) -> requests.Response:
        return self._s.get(f"{self.base_url}{path}", **kw)

    def post(self, path: str, **kw) -> requests.Response:
        return self._s.post(f"{self.base_url}{path}", **kw)

    def put(self, path: str, **kw) -> requests.Response:
        return self._s.put(f"{self.base_url}{path}", **kw)

    def delete(self, path: str, **kw) -> requests.Response:
        return self._s.delete(f"{self.base_url}{path}", **kw)

    # ── 快捷方法 ──────────────────────────────────────────────────

    @property
    def user_id(self) -> str:
        return self.user.get("id", "")

    def send_message(self, conv_id: str, content: str, msg_type: str = "text") -> requests.Response:
        return self.post(
            f"/api/messages/{conv_id}",
            json={"content": content, "type": msg_type},
        )

    def get_missed(self, after: int) -> requests.Response:
        return self.get(f"/api/messages/missed?after={after}")

    def send_friend_request(self, to_id: str, message: str = "") -> requests.Response:
        return self.post(
            "/api/users/friend-request",
            json={"toId": to_id, "message": message},
        )

    def set_group_manage(self, conv_id: str, **flags) -> requests.Response:
        return self.put(f"/api/messages/conversation/{conv_id}/manage", json=flags)
