#!/usr/bin/env python3
"""App Store 正式版审核看门狗（appstore-watch.yml 每小时运行）。

只读。发现以下情况时以非零退出码结束，GitHub 会给仓库账号发工作流失败通知邮件：
  - 待审/审核中的版本所挂构建已过期（2026-09 连续两次提交因此卡死在「等待审核」）
  - 审核被拒（UNRESOLVED_ISSUES / REJECTED / METADATA_REJECTED）
正常时只打印状态。
"""
import base64, os, sys, time
import jwt, requests

APP_ID = "6805065540"
API = "https://api.appstoreconnect.apple.com/v1"
KEY = base64.b64decode(os.environ["ASC_API_KEY_BASE64"]).decode()
HEAD = {"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"}
ISSUER = os.environ["ASC_ISSUER_ID"]


def get(path):
    now = int(time.time())
    token = jwt.encode({"iss": ISSUER, "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"}, KEY, algorithm="ES256", headers=HEAD)
    r = requests.get(API + path, headers={"Authorization": "Bearer " + token}, timeout=60)
    r.raise_for_status()
    return r.json()


problems = []
subs = get(f"/apps/{APP_ID}/reviewSubmissions?filter[platform]=IOS&include=appStoreVersionForReview&limit=20")["data"]
active = [s for s in subs if s["attributes"]["state"] in ("WAITING_FOR_REVIEW", "IN_REVIEW", "UNRESOLVED_ISSUES")]
if not active:
    print("当前没有进行中的 App Store 审核提交。")
for s in active:
    state = s["attributes"]["state"]
    rel = (s.get("relationships", {}).get("appStoreVersionForReview") or {}).get("data")
    if not rel:
        continue
    version = get(f"/appStoreVersions/{rel['id']}")["data"]["attributes"]
    build = (get(f"/appStoreVersions/{rel['id']}/build").get("data") or {}).get("attributes", {})
    line = (f"提交 {s['id'][:8]} 状态 {state} | 版本 {version['versionString']} {version['appStoreState']} | "
            f"构建 {build.get('version')} {'已过期' if build.get('expired') else '有效'}，到期 {str(build.get('expirationDate'))[:10]}")
    print(line)
    if build.get("expired"):
        problems.append("审核中版本挂的构建已过期，提交会一直卡住，需要撤回并换有效构建重新提交。" + line)
    if state == "UNRESOLVED_ISSUES" or version["appStoreState"] in ("REJECTED", "METADATA_REJECTED"):
        problems.append("审核被拒，请到 App Store Connect 查看拒审原因。" + line)

if problems:
    print("\n".join("❌ " + p for p in problems))
    sys.exit(1)
print("✅ 正常")
