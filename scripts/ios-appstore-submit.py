#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把指定 iOS 构建提交到 App Store 正式版审核（App Store Connect API，无需登录网页）。

做的事（全部幂等，可重复运行；--dry-run 只读不写）：
  1. 找 App（bundle id 与 ios-testflight-submit.py 同源：ios/testflight-config.json 的 bundle / TF_BUNDLE）
  2. 找构建：--build-number 精确匹配（未处理完会轮询等 VALID），否则取该版本号最新的 VALID 未过期构建；
     出口合规未回答时设为「不含非豁免加密」（Info.plist 已声明 ITSAppUsesNonExemptEncryption=false，通常无需改）
  3. 找或建 appStoreVersion（platform=IOS, versionString=--version）：
     - 同版本号已存在且可编辑 → 直接用
     - 同版本号已在审核/待发布/已上架 → 挂的就是这个构建则视为已提交（退出码 0），否则报错要人工处理
     - 另有一个可编辑版本（每个平台只能有一个）且版本号低于目标 → 只改它的 versionString；
       版本号不低于目标（如手工准备的 8.2.0 草稿）→ 报错，交人工决定，绝不静默改名
     - 另有版本在审核/待发布 → 退出码 3「被占用」（Apple 不允许此时新建版本，不自动撤回）
     - 都没有 → 新建；releaseType 沿用上一版本（MANUAL/AFTER_APPROVAL；SCHEDULED 的日期不可复用 → 改 MANUAL），
       上一版本用了分阶段发布则新版本也开启分阶段发布
  4. 每个已有本地化写入「此版本的新内容」(whatsNew)：ios/testflight-config.json 的 appStoreWhatsNew
     （字符串，或 {"zh-Hans": ..., "en-US": ..., "default": ...}），或 --whats-new-file
  5. 版本缺审核联系信息(appStoreReviewDetail)时，用 testflight-config.json 的联系人/演示账号补上（已有不动）
  6. 把构建挂到版本上（PATCH appStoreVersions/{id}/relationships/build）
  7. 复用未提交的 reviewSubmission（只含本版本的草稿，或被拒待处理的那条）/ 新建一条 → 加入该版本 → submitted=true
     （submitted PATCH 不盲目重试：出错后重新读取提交状态，已进审核队列即视为成功）

环境变量：ASC_KEY_ID、ASC_ISSUER_ID，以及 ASC_P8_PATH（.p8 文件）或 ASC_API_KEY_BASE64（.p8 的 base64）。
可选 ASC_APP_ID（跳过按 bundle 查 App）。

  python3 scripts/ios-appstore-submit.py --version 8.1.41 --dry-run
  python3 scripts/ios-appstore-submit.py --version 8.1.41 --build-number 1760300000

退出码：0 = 已提交 / 之前已提交 / dry-run 完成；1 = 出错（日志里有原因与 ASC 返回的错误）；
       3 = 被占用：另一版本/另一条提交仍在审核或待发布，现在无法提交（稍后用 ios-appstore-submit.yml 重跑）。
"""
import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.appstoreconnect.apple.com/v1"

# appVersionState（新）/ appStoreState（旧）两套取值都覆盖。
EDITABLE_STATES = {
    "PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED",
    "INVALID_BINARY", "READY_FOR_REVIEW",
}
IN_FLIGHT_STATES = {
    "WAITING_FOR_REVIEW", "IN_REVIEW", "WAITING_FOR_EXPORT_COMPLIANCE", "PENDING_CONTRACT",
    "PENDING_DEVELOPER_RELEASE", "PENDING_APPLE_RELEASE", "PROCESSING_FOR_APP_STORE",
    "PROCESSING_FOR_DISTRIBUTION", "ACCEPTED",
}
RELEASED_STATES = {
    "READY_FOR_SALE", "READY_FOR_DISTRIBUTION", "REPLACED_WITH_NEW_VERSION", "REMOVED_FROM_SALE",
    "DEVELOPER_REMOVED_FROM_SALE", "NOT_APPLICABLE",
}
SUBMISSION_IN_REVIEW = ("WAITING_FOR_REVIEW", "IN_REVIEW")
SUBMISSION_BUSY = ("CANCELING", "COMPLETING")   # 过渡态：等它结束再提交
SUBMISSION_OPEN = ("READY_FOR_REVIEW", "UNRESOLVED_ISSUES") + SUBMISSION_IN_REVIEW + SUBMISSION_BUSY
EXIT_BLOCKED = 3
DRY_RUN_VERSION_ID = "DRY-RUN-NEW-VERSION"
DRY_RUN_SUBMISSION_ID = "DRY-RUN-NEW-SUBMISSION"


def log(msg=""):
    print(msg, flush=True)


def ok(msg):
    log(f"✅ {msg}")


def step(msg):
    log(f"\n▶ {msg}")


class SubmitError(Exception):
    pass


class BlockedError(SubmitError):
    """另一版本/提交仍在审核或待发布：不是脚本或配置错误，稍后重跑即可。"""


class ApiError(SubmitError):
    def __init__(self, method, path, status, raw):
        self.status = status
        try:
            errors = json.loads(raw or b"{}").get("errors") or []
        except ValueError:
            errors = []
        self.codes = [e.get("code", "") for e in errors]
        detail = "; ".join(f"{e.get('code', '')}: {e.get('title', '')} {e.get('detail', '')}".strip() for e in errors)
        if not detail:
            detail = (raw or b"").decode("utf-8", "replace")[:500]
        super().__init__(f"{method} {path} -> HTTP {status}: {detail}")


# ── 认证：与 ios-testflight-submit.py 相同的 ES256 JWT（PyJWT），token 缓存 15 分钟 ──────────
def load_private_key():
    path = os.environ.get("ASC_P8_PATH")
    if path:
        with open(path) as f:
            return f.read()
    b64 = os.environ.get("ASC_API_KEY_BASE64")
    if b64:
        return base64.b64decode(b64).decode()
    raise SubmitError("缺少 ASC_P8_PATH 或 ASC_API_KEY_BASE64")


def make_token_provider(key_id, issuer, private_key):
    import jwt  # PyJWT（+cryptography），与 ios-testflight-submit.py / appstore-watch.py 一致

    cache = {"token": None, "exp": 0}

    def provide():
        now = int(time.time())
        if cache["token"] and cache["exp"] - now > 60:
            return cache["token"]
        exp = now + 900
        token = jwt.encode({"iss": issuer, "iat": now, "exp": exp, "aud": "appstoreconnect-v1"},
                           private_key, algorithm="ES256", headers={"kid": key_id, "typ": "JWT"})
        cache.update(token=token, exp=exp)
        return token

    return provide


class AscClient:
    """最小 ASC REST 客户端（urllib）。dry-run 时所有写请求只打印、不发送。"""

    def __init__(self, token_provider, dry_run=False, urlopen=None, sleep=time.sleep, base=API):
        self.token = token_provider
        self.dry_run = dry_run
        self.urlopen = urlopen or urllib.request.urlopen
        self.sleep = sleep
        self.base = base

    def get(self, path, params=None):
        return self.request("GET", path, params=params)

    def post(self, path, body):
        return self.request("POST", path, body=body)

    def patch(self, path, body, retry=True):
        return self.request("PATCH", path, body=body, retry=retry)

    def request(self, method, path, params=None, body=None, retry=True):
        if method != "GET" and self.dry_run:
            shown = json.dumps(redact(body), ensure_ascii=False) if body is not None else ""
            log(f"   [dry-run] 将 {method} {path} {shown[:400]}")
            return None
        url = self.base + path
        if params:
            url += "?" + urllib.parse.urlencode(params, safe="[],.-")
        data = json.dumps(body).encode() if body is not None else None
        # GET/PATCH 幂等，5xx/网络错误重试；POST 只在 429（明确未处理）时重试，避免重复创建。
        for attempt in range(4):
            req = urllib.request.Request(url, data=data, method=method, headers={
                "Authorization": f"Bearer {self.token()}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            })
            try:
                with self.urlopen(req, timeout=60) as resp:
                    raw = resp.read()
                    return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as e:
                raw = e.read()
                retryable = e.code == 429 or (retry and method != "POST" and e.code >= 500)
                if retryable and attempt < 3:
                    wait = 5 * (2 ** attempt)
                    log(f"   {method} {path} -> {e.code}，{wait}s 后重试")
                    self.sleep(wait)
                    continue
                raise ApiError(method, path, e.code, raw)
            except urllib.error.URLError as e:
                if retry and method != "POST" and attempt < 3:
                    self.sleep(5 * (2 ** attempt))
                    continue
                raise SubmitError(f"{method} {path} 网络错误: {e.reason}")
        raise SubmitError(f"{method} {path} 重试后仍失败")


def redact(value):
    """日志里不打印演示账号密码。"""
    if isinstance(value, dict):
        return {k: ("***" if "password" in k.lower() else redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    return value


def version_tuple(s):
    try:
        return tuple(int(x) for x in (s or "").split("."))
    except ValueError:
        return None


def version_state(v):
    a = v.get("attributes", {})
    return a.get("appVersionState") or a.get("appStoreState") or ""


def pick_text(whats_new, locale):
    if isinstance(whats_new, str):
        return whats_new
    if not isinstance(whats_new, dict):
        return None
    if locale in whats_new:
        return whats_new[locale]
    lang = locale.split("-")[0]
    for key, text in whats_new.items():
        if key.split("-")[0] == lang:
            return text
    return whats_new.get("default")


# ── 各步骤 ───────────────────────────────────────────────────────────────────
def find_app(client, bundle, app_id=None):
    if app_id:
        ok(f"App id {app_id}（ASC_APP_ID）")
        return app_id
    apps = client.get("/apps", {"filter[bundleId]": bundle})["data"]
    if not apps:
        raise SubmitError(f"找不到 bundle id 为 {bundle} 的 App")
    ok(f"App: {apps[0]['attributes'].get('name')} ({apps[0]['id']})")
    return apps[0]["id"]


def find_build(client, app_id, version, build_number=None, wait_max=1800, interval=30):
    step(f"查找 {version} 的构建" + (f" {build_number}" if build_number else "（最新 VALID）"))
    waited = 0
    while True:
        params = {"filter[app]": app_id, "filter[preReleaseVersion.version]": version,
                  "sort": "-uploadedDate", "limit": "20"}
        if build_number:
            params["filter[version]"] = str(build_number)
        builds = client.get("/builds", params)["data"]
        if build_number:
            build = next((b for b in builds if str(b["attributes"].get("version")) == str(build_number)), None)
            if build is not None:
                state = build["attributes"].get("processingState")
                if build["attributes"].get("expired"):
                    raise SubmitError(f"构建 {build_number} 已过期，不能提交审核")
                if state == "VALID":
                    return build
                if state in ("FAILED", "INVALID"):
                    raise SubmitError(f"构建 {build_number} 处理失败（{state}）")
                log(f"   构建 {build_number} 状态 {state}，等待处理…（{waited}s）")
            else:
                log(f"   构建 {build_number} 还没出现在 API，等待…（{waited}s）")
        else:
            usable = [b for b in builds if not b["attributes"].get("expired")]
            valid = [b for b in usable if b["attributes"].get("processingState") == "VALID"]
            if valid:
                return valid[0]
            if not any(b["attributes"].get("processingState") == "PROCESSING" for b in usable):
                raise SubmitError(f"版本 {version} 没有可用（VALID 且未过期）的构建")
            log(f"   版本 {version} 的构建仍在处理，等待…（{waited}s）")
        if waited >= wait_max:
            raise SubmitError(f"等待构建处理超时（{wait_max}s），稍后重跑本脚本即可")
        client.sleep(interval)
        waited += interval


def ensure_encryption_answer(client, build):
    if build["attributes"].get("usesNonExemptEncryption") is None:
        client.patch(f"/builds/{build['id']}", {"data": {"type": "builds", "id": build["id"],
                                                         "attributes": {"usesNonExemptEncryption": False}}})
        ok("出口合规：已回答「不含非豁免加密」（仅标准 HTTPS，与 Info.plist 一致）")


def attached_build_id(client, version_id):
    if version_id == DRY_RUN_VERSION_ID:
        return None
    rel = client.get(f"/appStoreVersions/{version_id}/relationships/build")
    return ((rel or {}).get("data") or {}).get("id")


def ensure_version(client, app_id, version, build_id):
    """返回 (version_id, already_submitted)。"""
    step(f"找或建 App Store 版本 {version}")
    versions = client.get(f"/apps/{app_id}/appStoreVersions",
                          {"filter[platform]": "IOS", "limit": "200"})["data"]
    for v in versions:
        log(f"   现有版本 {v['attributes'].get('versionString')} {version_state(v)} ({v['id']})")
    same = next((v for v in versions if v["attributes"].get("versionString") == version), None)
    if same is not None:
        state = version_state(same)
        if state in EDITABLE_STATES:
            ok(f"复用可编辑版本 {version}（{state}）")
            return same["id"], False
        current = attached_build_id(client, same["id"])
        if state in IN_FLIGHT_STATES or state in RELEASED_STATES:
            if current == build_id:
                ok(f"版本 {version} 已是 {state}，挂的就是构建 {build_id}，无需重复提交")
                return same["id"], True
            raise SubmitError(f"版本 {version} 已是 {state}，挂的构建是 {current}，不是 {build_id}；"
                              "如需换构建，请先在 App Store Connect 撤回该版本的审核")
        raise SubmitError(f"版本 {version} 处于未知状态 {state}，请人工确认")

    editable = [v for v in versions if version_state(v) in EDITABLE_STATES]
    if editable:
        other = editable[0]
        old = other["attributes"].get("versionString")
        old_t, new_t = version_tuple(old), version_tuple(version)
        if old_t is None or new_t is None or old_t >= new_t:
            raise SubmitError(f"已有可编辑版本 {old}（{version_state(other)}），版本号不低于 {version}；"
                              "可能是手工准备的版本，不自动改名，请在 App Store Connect 人工处理")
        client.patch(f"/appStoreVersions/{other['id']}", {"data": {
            "type": "appStoreVersions", "id": other["id"], "attributes": {"versionString": version}}})
        ok(f"已有可编辑版本 {old}（{version_state(other)}），版本号改为 {version}（每个平台只能有一个可编辑版本）")
        return other["id"], False

    blocking = [v for v in versions if version_state(v) in IN_FLIGHT_STATES]
    if blocking:
        b = blocking[0]
        raise BlockedError(f"版本 {b['attributes'].get('versionString')} 仍是 {version_state(b)}，"
                           "Apple 不允许此时新建版本；等它发布/撤回后再运行 ios-appstore-submit.yml")

    attributes = {"platform": "IOS", "versionString": version}
    released = sorted((v for v in versions if version_state(v) in RELEASED_STATES),
                      key=lambda v: v["attributes"].get("createdDate") or "", reverse=True)
    previous = released[0] if released else None
    release_type = previous["attributes"].get("releaseType") if previous else None
    if release_type in ("MANUAL", "AFTER_APPROVAL"):
        attributes["releaseType"] = release_type
        log(f"   沿用上一版本的发布方式 releaseType={release_type}")
    elif release_type == "SCHEDULED":
        # 定时发布的日期属于上一版本，不能复用；改成手动发布，绝不默认成「审核通过即上架」
        attributes["releaseType"] = "MANUAL"
        log("   上一版本是定时发布（SCHEDULED），日期不可复用 → 新版本改为手动发布 MANUAL")
    phased = previous_phased_release(client, previous["id"]) if previous else None
    created = client.post("/appStoreVersions", {"data": {
        "type": "appStoreVersions", "attributes": attributes,
        "relationships": {"app": {"data": {"type": "apps", "id": app_id}}}}})
    if created is None:
        ok(f"[dry-run] 将新建版本 {version}" + ("（并开启分阶段发布）" if phased else ""))
        return DRY_RUN_VERSION_ID, False
    vid = created["data"]["id"]
    ok(f"已新建版本 {version}（{vid}）")
    if phased:
        try:
            client.post("/appStoreVersionPhasedReleases", {"data": {
                "type": "appStoreVersionPhasedReleases", "attributes": {"phasedReleaseState": "INACTIVE"},
                "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": vid}}}}})
            ok("沿用上一版本：开启分阶段发布（7 天逐步放量）")
        except SubmitError as e:
            log(f"::warning::上一版本用了分阶段发布，但新版本开启失败，请在 App Store Connect 手动开启：{e}")
    return vid, False


def previous_phased_release(client, version_id):
    """上一版本是否用了分阶段发布（读不到按没有处理，只打日志）。"""
    try:
        data = (client.get(f"/appStoreVersions/{version_id}/appStoreVersionPhasedRelease") or {}).get("data")
    except SubmitError as e:
        log(f"   读取上一版本分阶段发布设置失败（按未开启处理）：{e}")
        return None
    if data:
        log(f"   上一版本使用了分阶段发布（{(data.get('attributes') or {}).get('phasedReleaseState')}）")
    return data


def ensure_whats_new(client, version_id, whats_new):
    step("填写「此版本的新内容」")
    if version_id == DRY_RUN_VERSION_ID:
        log("   [dry-run] 新版本建好后会给每个本地化写入 whatsNew")
        return
    locs = client.get(f"/appStoreVersions/{version_id}/appStoreVersionLocalizations", {"limit": "50"})["data"]
    if not locs:
        raise SubmitError("该版本没有任何本地化，无法写 whatsNew（请先在 App Store Connect 补齐 App 信息）")
    for loc in locs:
        locale = loc["attributes"].get("locale")
        text = pick_text(whats_new, locale)
        if not text:
            raise SubmitError(f"appStoreWhatsNew 没有 {locale} 可用的文案（可加 default）")
        if loc["attributes"].get("whatsNew") == text:
            ok(f"{locale} 已是最新文案")
            continue
        client.patch(f"/appStoreVersionLocalizations/{loc['id']}", {"data": {
            "type": "appStoreVersionLocalizations", "id": loc["id"], "attributes": {"whatsNew": text}}})
        ok(f"{locale} whatsNew 已写入")


def ensure_review_detail(client, version_id, detail):
    if version_id == DRY_RUN_VERSION_ID or not detail:
        return
    try:
        existing = (client.get(f"/appStoreVersions/{version_id}/appStoreReviewDetail") or {}).get("data")
    except ApiError as e:
        if e.status != 404:
            raise
        existing = None
    if existing:
        ok("审核联系信息已存在，保持不变")
        return
    client.post("/appStoreReviewDetails", {"data": {
        "type": "appStoreReviewDetails", "attributes": detail,
        "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": version_id}}}}})
    ok("已补齐审核联系信息/演示账号")


def ensure_build_attached(client, version_id, build_id):
    step(f"把构建 {build_id} 挂到版本上")
    if attached_build_id(client, version_id) == build_id:
        ok("构建已挂好")
        return
    client.patch(f"/appStoreVersions/{version_id}/relationships/build",
                 {"data": {"type": "builds", "id": build_id}})
    ok("构建已挂到版本")


def submission_item_versions(client, submission_id):
    """该提交里每个 item 挂的 appStoreVersion id（非版本类 item 记为 None）。"""
    items = client.get(f"/reviewSubmissions/{submission_id}/items",
                       {"include": "appStoreVersion", "limit": "50"})["data"]
    return [((i.get("relationships", {}).get("appStoreVersion") or {}).get("data") or {}).get("id") for i in items]


def submission_has_version(client, submission_id, version_id):
    return version_id in submission_item_versions(client, submission_id)


def mark_submitted(client, sid, version_id):
    """PATCH submitted=true 不盲目重试：首个请求可能已生效却返回 5xx/超时，重试会 409。
    出错后重新读取提交状态，已进审核队列且含本版本即视为成功。"""
    try:
        return client.patch(f"/reviewSubmissions/{sid}", {"data": {
            "type": "reviewSubmissions", "id": sid, "attributes": {"submitted": True}}}, retry=False)
    except (SubmitError, OSError) as e:
        log(f"   提交请求出错（{e}），重新读取提交状态确认…")
        client.sleep(10)
        current = client.get(f"/reviewSubmissions/{sid}")
        state = (current or {}).get("data", {}).get("attributes", {}).get("state")
        if state in SUBMISSION_IN_REVIEW and submission_has_version(client, sid, version_id):
            log(f"   提交实际已生效（{state}）")
            return current
        raise


def ensure_submitted(client, app_id, version_id):
    """返回 'submitted' | 'already_submitted' | 'dry_run'。"""
    step("提交 App Store 审核（reviewSubmissions）")
    subs = client.get(f"/apps/{app_id}/reviewSubmissions",
                      {"filter[platform]": "IOS", "filter[state]": ",".join(SUBMISSION_OPEN), "limit": "50"})["data"]
    target = None
    for s in subs:
        state = s["attributes"].get("state")
        has = submission_has_version(client, s["id"], version_id) if version_id != DRY_RUN_VERSION_ID else False
        log(f"   现有提交 {s['id']} {state}{'（含本版本）' if has else ''}")
        if state in SUBMISSION_IN_REVIEW:
            if has:
                ok("本版本已在审核队列中，无需重复提交")
                return "already_submitted"
            raise BlockedError(f"已有一条 {state} 的审核提交（{s['id']}），Apple 不允许同时再提交；等它结束后重跑")
        if state in SUBMISSION_BUSY:
            raise BlockedError(f"审核提交 {s['id']} 正处于 {state}，等它结束后重跑")
        if state == "UNRESOLVED_ISSUES" and has:
            target = s
        elif state == "READY_FOR_REVIEW" and target is None:
            others = [v for v in submission_item_versions(client, s["id"]) if v != version_id]
            if others:
                raise SubmitError(f"已有一条未提交的审核草稿 {s['id']}，里面还有别的项目（{others}）；"
                                  "不自动连带提交，请在 App Store Connect 人工处理")
            target = s
    if target is None:
        created = client.post("/reviewSubmissions", {"data": {
            "type": "reviewSubmissions", "attributes": {"platform": "IOS"},
            "relationships": {"app": {"data": {"type": "apps", "id": app_id}}}}})
        sid = created["data"]["id"] if created else DRY_RUN_SUBMISSION_ID
        ok(f"新建审核提交 {sid}")
        has = False
    else:
        sid = target["id"]
        has = target["attributes"].get("state") == "UNRESOLVED_ISSUES" or submission_has_version(client, sid, version_id)
        ok(f"复用审核提交 {sid}（{target['attributes'].get('state')}）")
    if not has:
        client.post("/reviewSubmissionItems", {"data": {
            "type": "reviewSubmissionItems",
            "relationships": {
                "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": sid}},
                "appStoreVersion": {"data": {"type": "appStoreVersions", "id": version_id}},
            }}})
        ok("版本已加入审核提交")
    result = mark_submitted(client, sid, version_id)
    if result is None:
        return "dry_run"
    ok(f"已提交 App Store 审核 🎉 状态 {result['data']['attributes'].get('state')}")
    return "submitted"


def submit(client, *, bundle, version, whats_new, build_number=None, app_id=None, review_detail=None,
           wait_max=1800, interval=30):
    app = find_app(client, bundle, app_id)
    build = find_build(client, app, version, build_number, wait_max, interval)
    ok(f"构建 {build['attributes'].get('version')}（{build['id']}，{build['attributes'].get('processingState')}）")
    version_id, already = ensure_version(client, app, version, build["id"])
    if already:
        return {"status": "already_submitted", "app": app, "version": version_id, "build": build["id"]}
    ensure_encryption_answer(client, build)
    ensure_whats_new(client, version_id, whats_new)
    ensure_review_detail(client, version_id, review_detail)
    if version_id == DRY_RUN_VERSION_ID:
        log(f"   [dry-run] 新版本建好后会挂构建 {build['id']}")
    else:
        ensure_build_attached(client, version_id, build["id"])
    status = ensure_submitted(client, app, version_id)
    if client.dry_run:
        status = "dry_run"
    return {"status": status, "app": app, "version": version_id, "build": build["id"]}


def review_detail_from_config(cfg):
    if not cfg.get("contact_email") and not cfg.get("demo_account"):
        return None
    detail = {
        "contactFirstName": cfg.get("contact_first") or "",
        "contactLastName": cfg.get("contact_last") or "",
        "contactEmail": cfg.get("contact_email") or cfg.get("feedback_email") or "",
        "contactPhone": cfg.get("contact_phone") or "",
        "demoAccountRequired": bool(cfg.get("demo_account")),
        "demoAccountName": cfg.get("demo_account") or "",
        "demoAccountPassword": cfg.get("demo_password") or "",
        "notes": cfg.get("review_notes") or "",
    }
    return detail


def main(argv=None, client=None):
    p = argparse.ArgumentParser(description="提交 iOS 构建到 App Store 正式版审核")
    p.add_argument("--version", required=True, help="版本号，如 8.1.41")
    p.add_argument("--build-number", default="", help="构建号；留空取该版本最新 VALID 构建")
    p.add_argument("--config", default="ios/testflight-config.json")
    p.add_argument("--bundle", default="", help="默认取 config 的 bundle / TF_BUNDLE")
    p.add_argument("--app-id", default=os.environ.get("ASC_APP_ID", ""))
    p.add_argument("--whats-new-file", default="", help="纯文本文件，所有语言共用；不填则读 config 的 appStoreWhatsNew")
    p.add_argument("--dry-run", action="store_true", help="只读：打印将要做的写操作，不调用任何写接口")
    p.add_argument("--wait-max", type=int, default=1800, help="等待构建处理为 VALID 的最长秒数")
    p.add_argument("--poll-interval", type=int, default=30)
    args = p.parse_args(argv)

    try:
        if not re.fullmatch(r"\d+\.\d+(\.\d+)?", args.version):
            raise SubmitError(f"版本号格式不对：{args.version}")
        if args.build_number and not re.fullmatch(r"\d+(\.\d+)*", args.build_number):
            raise SubmitError(f"构建号格式不对：{args.build_number}")
        cfg = {}
        if os.path.exists(args.config):
            with open(args.config, encoding="utf-8") as f:
                cfg = json.load(f)
        bundle = args.bundle or os.environ.get("TF_BUNDLE") or cfg.get("bundle") or "com.touliao.app"
        if args.whats_new_file:
            with open(args.whats_new_file, encoding="utf-8") as f:
                whats_new = f.read().strip()
        else:
            whats_new = cfg.get("appStoreWhatsNew")
        if not whats_new:
            raise SubmitError("缺少更新说明：在 ios/testflight-config.json 加 appStoreWhatsNew，或传 --whats-new-file")

        log(f"App Store 提交：bundle={bundle} version={args.version} build={args.build_number or '最新 VALID'}"
            f"{'（dry-run，只读）' if args.dry_run else ''}")
        if client is None:
            token = make_token_provider(os.environ["ASC_KEY_ID"], os.environ["ASC_ISSUER_ID"], load_private_key())
            client = AscClient(token, dry_run=args.dry_run)
        result = submit(client, bundle=bundle, version=args.version, whats_new=whats_new,
                        build_number=args.build_number or None, app_id=args.app_id or None,
                        review_detail=review_detail_from_config(cfg),
                        wait_max=args.wait_max, interval=args.poll_interval)
    except KeyError as e:
        log(f"❌ 缺少环境变量 {e}")
        return 1
    except BlockedError as e:
        log(f"⏸ {e}")
        return EXIT_BLOCKED
    except SubmitError as e:
        log(f"❌ {e}")
        return 1
    log("\nRESULT " + json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
