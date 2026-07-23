#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动为最新 TestFlight 构建填写测试信息，并可选提交外部 Beta 审核。
用 App Store Connect API，无需登录网页。

配置来自环境变量（见下）。运行示例：
  export ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_P8_PATH=/root/AuthKey_XXX.p8
  export TF_FEEDBACK_EMAIL='you@example.com'
  export TF_DESCRIPTION='v信 是一款即时通讯 App…'
  export TF_WHATS_NEW='本次测试：登录/聊天/朋友圈/音视频通话'
  export TF_DEMO_ACCOUNT='13800000000'
  export TF_DEMO_PASSWORD='Test123456'
  export TF_CONTACT_FIRST='San' TF_CONTACT_LAST='Zhang'
  export TF_CONTACT_EMAIL='you@example.com' TF_CONTACT_PHONE='+8613800000000'
  export TF_REVIEW_NOTES='测试账号已填，登录后可体验全部功能'
  # 走外部审核 + 送审：
  export TF_MODE=external           # internal(默认,只填信息) | external(建组+送审)
  export TF_GROUP_NAME='公开测试'
  python3 scripts/ios-testflight-submit.py
"""
import os, sys, time, jwt, requests

KEY_ID   = os.environ["ASC_KEY_ID"]
ISSUER   = os.environ["ASC_ISSUER_ID"]
P8       = os.environ["ASC_P8_PATH"]
BUNDLE   = os.environ.get("TF_BUNDLE", "com.vxin.app")
LOCALE   = os.environ.get("TF_LOCALE", "zh-Hans")
MODE     = os.environ.get("TF_MODE", "internal").lower()
API      = "https://api.appstoreconnect.apple.com/v1"

def g(k, d=""): return os.environ.get(k, d)
FEEDBACK = g("TF_FEEDBACK_EMAIL")
DESC     = g("TF_DESCRIPTION")
WHATSNEW = g("TF_WHATS_NEW", "首个测试版本：请体验登录、聊天、朋友圈、音视频通话等功能。")
DEMO_ACC = g("TF_DEMO_ACCOUNT")
DEMO_PWD = g("TF_DEMO_PASSWORD")
C_FIRST  = g("TF_CONTACT_FIRST"); C_LAST=g("TF_CONTACT_LAST")
C_EMAIL  = g("TF_CONTACT_EMAIL", FEEDBACK); C_PHONE=g("TF_CONTACT_PHONE")
NOTES    = g("TF_REVIEW_NOTES")
GROUP    = g("TF_GROUP_NAME", "External Testers")

def die(m): print(f"❌ {m}"); sys.exit(1)
def ok(m):  print(f"✅ {m}")
def step(m):print(f"\n▶ {m}")

def tok():
    return jwt.encode({"iss":ISSUER,"iat":int(time.time()),"exp":int(time.time())+900,
                       "aud":"appstoreconnect-v1"}, open(P8).read(),
                      algorithm="ES256", headers={"kid":KEY_ID})
def H(ct=True):
    h={"Authorization":f"Bearer {tok()}"}
    if ct: h["Content-Type"]="application/json"
    return h
def req(m,p,**kw):
    url=p if p.startswith("http") else API+p
    r=requests.request(m,url,headers=H(),timeout=40,**kw)
    if r.status_code>=300: die(f"{m} {p} -> {r.status_code}\n{r.text}")
    return r.json() if r.text else {}

# App
app=req("GET",f"/apps?filter[bundleId]={BUNDLE}")["data"]
if not app: die(f"找不到 App {BUNDLE}")
APPID=app[0]["id"]; ok(f"App: {app[0]['attributes']['name']} ({APPID})")

# 最新 VALID 构建
step("查找最新可用构建")
builds=req("GET",f"/builds?filter[app]={APPID}&sort=-uploadedDate&limit=10")["data"]
build=next((b for b in builds if b["attributes"]["processingState"]=="VALID"), None)
if not build:
    die("暂无 VALID 构建（可能还在处理中，稍后再运行）")
BUILDID=build["id"]; ok(f"构建 build {build['attributes']['version']} ({BUILDID})")

# 1) Beta App Localization（App 级测试信息：反馈邮箱/描述）
step("填写 App 级测试信息 (BetaAppLocalization)")
locs=req("GET",f"/apps/{APPID}/betaAppLocalizations")["data"]
cur=next((l for l in locs if l["attributes"]["locale"]==LOCALE), None)
attrs={"feedbackEmail":FEEDBACK or None, "description":DESC or None}
attrs={k:v for k,v in attrs.items() if v}
if cur:
    if attrs:
        req("PATCH",f"/betaAppLocalizations/{cur['id']}",
            json={"data":{"type":"betaAppLocalizations","id":cur["id"],"attributes":attrs}})
    ok(f"已更新 {LOCALE} 测试信息")
else:
    body={"data":{"type":"betaAppLocalizations","attributes":{**attrs,"locale":LOCALE},
          "relationships":{"app":{"data":{"type":"apps","id":APPID}}}}}
    req("POST","/betaAppLocalizations",json=body); ok(f"已创建 {LOCALE} 测试信息")

# 2) Beta Build Localization（本构建的“测试内容 What to Test”）
step("填写本构建的『测试内容』(BetaBuildLocalization)")
bls=req("GET",f"/builds/{BUILDID}/betaBuildLocalizations")["data"]
cur=next((l for l in bls if l["attributes"]["locale"]==LOCALE), None)
if cur:
    req("PATCH",f"/betaBuildLocalizations/{cur['id']}",
        json={"data":{"type":"betaBuildLocalizations","id":cur["id"],
                      "attributes":{"whatsNew":WHATSNEW}}})
    ok("已更新测试内容")
else:
    body={"data":{"type":"betaBuildLocalizations","attributes":{"whatsNew":WHATSNEW,"locale":LOCALE},
          "relationships":{"build":{"data":{"type":"builds","id":BUILDID}}}}}
    req("POST","/betaBuildLocalizations",json=body); ok("已创建测试内容")

# 3) Beta App Review Detail（送外审要用的联系人/演示账号/备注）
if MODE=="external":
    step("填写 Beta 审核联系信息 (BetaAppReviewDetail)")
    ra={"contactFirstName":C_FIRST or "Test","contactLastName":C_LAST or "User",
        "contactEmail":C_EMAIL or FEEDBACK,"contactPhone":C_PHONE or "+8610000000000",
        "demoAccountRequired": bool(DEMO_ACC),
        "demoAccountName":DEMO_ACC or "","demoAccountPassword":DEMO_PWD or "",
        "notes":NOTES or ""}
    rd=requests.get(f"{API}/apps/{APPID}/betaAppReviewDetail",headers=H())
    if rd.status_code<300 and rd.json().get("data"):
        rid=rd.json()["data"]["id"]
        req("PATCH",f"/betaAppReviewDetails/{rid}",
            json={"data":{"type":"betaAppReviewDetails","id":rid,"attributes":ra}})
    else:
        req("POST","/betaAppReviewDetails",
            json={"data":{"type":"betaAppReviewDetails","attributes":ra,
                  "relationships":{"app":{"data":{"type":"apps","id":APPID}}}}})
    ok("联系人/演示账号已写入")

    # 4) 外部测试组 + 关联构建 + 送审
    step(f"确保外部测试组『{GROUP}』并关联构建")
    grps=req("GET",f"/apps/{APPID}/betaGroups?limit=200")["data"]
    grp=next((x for x in grps if x["attributes"]["name"]==GROUP), None)
    if not grp:
        grp=req("POST","/betaGroups",
            json={"data":{"type":"betaGroups","attributes":{"name":GROUP,"isInternalGroup":False},
                  "relationships":{"app":{"data":{"type":"apps","id":APPID}}}}})["data"]
        ok(f"已创建外部组 {grp['id']}")
    else:
        ok(f"复用外部组 {grp['id']}")
    GID=grp["id"]
    # 关联构建到组
    req("POST",f"/betaGroups/{GID}/relationships/builds",
        json={"data":[{"type":"builds","id":BUILDID}]}); ok("构建已加入测试组")
    # 送 Beta 审核
    step("提交外部 Beta 审核")
    existing=requests.get(f"{API}/builds/{BUILDID}/betaAppReviewSubmission",headers=H())
    if existing.status_code<300 and existing.json().get("data"):
        ok("该构建已提交过 Beta 审核")
    else:
        req("POST","/betaAppReviewSubmissions",
            json={"data":{"type":"betaAppReviewSubmissions",
                  "relationships":{"build":{"data":{"type":"builds","id":BUILDID}}}}})
        ok("已提交外部 Beta 审核 🎉")
else:
    print("\n(internal 模式：仅填信息，未送审。内部测试员可直接安装此构建。)")

print("\n🎉 完成。去 App Store Connect → TestFlight 查看。")
