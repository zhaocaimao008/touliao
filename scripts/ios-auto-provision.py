#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
用 App Store Connect API 全自动完成 iOS 发布签名材料：
  1) 确保 Bundle ID (com.vxin.app) 存在，并开启 Push
  2) 用本地 CSR 申请 Apple Distribution 证书
  3) 用该证书 + Bundle ID 生成 App Store 描述文件 vxin_distribution
  4) 用 openssl 把 .cer + 本地私钥 合成 distribution.p12
  5) 写入 7 个 GitHub Secrets（调用 gh）

只需要你提供一个 App Store Connect API Key：
  环境变量:  ASC_KEY_ID  ASC_ISSUER_ID  ASC_P8_PATH(那个 .p8 文件路径)
"""
import os, sys, time, json, base64, subprocess, tempfile
import jwt, requests

BUNDLE_ID   = "com.vxin.app"
PROFILE_NAME= "vxin_distribution"
CERT_TYPE   = "IOS_DISTRIBUTION"          # Apple Distribution
PROFILE_TYPE= "IOS_APP_STORE"
IOS_DIR     = os.path.join(os.path.dirname(__file__), "..", "ios")
SIGN_DIR    = os.path.abspath(os.path.join(IOS_DIR, "signing"))
CSR_PATH    = os.path.join(SIGN_DIR, "ios_dist.csr")
KEY_PATH    = os.path.join(SIGN_DIR, "ios_dist.key")
API         = "https://api.appstoreconnect.apple.com/v1"

def die(m): print(f"❌ {m}"); sys.exit(1)
def ok(m):  print(f"✅ {m}")
def step(m):print(f"\n▶ {m}")

KEY_ID    = os.environ.get("ASC_KEY_ID")    or die("缺少 ASC_KEY_ID")
ISSUER_ID = os.environ.get("ASC_ISSUER_ID") or die("缺少 ASC_ISSUER_ID")
P8_PATH   = os.environ.get("ASC_P8_PATH")   or die("缺少 ASC_P8_PATH（.p8 文件路径）")
KEYCHAIN_PW = os.environ.get("IOS_KEYCHAIN_PASSWORD", "vxin-ci-keychain")
P12_PW      = os.environ.get("IOS_CERTIFICATE_PASSWORD", "vxin-p12-pass")

if not os.path.isfile(P8_PATH): die(f"找不到 .p8: {P8_PATH}")
if not os.path.isfile(CSR_PATH): die(f"找不到 CSR: {CSR_PATH}（先跑 openssl 生成）")
if not os.path.isfile(KEY_PATH): die(f"找不到私钥: {KEY_PATH}")

def token():
    with open(P8_PATH) as f: priv = f.read()
    payload = {"iss": ISSUER_ID, "iat": int(time.time()),
               "exp": int(time.time())+1200, "aud": "appstoreconnect-v1"}
    return jwt.encode(payload, priv, algorithm="ES256",
                      headers={"kid": KEY_ID, "typ": "JWT"})

def H(): return {"Authorization": f"Bearer {token()}", "Content-Type": "application/json"}

def req(method, path, **kw):
    url = path if path.startswith("http") else API+path
    r = requests.request(method, url, headers=H(), timeout=30, **kw)
    if r.status_code >= 300:
        die(f"{method} {path} -> {r.status_code}\n{r.text}")
    return r.json() if r.text else {}

# 1) Bundle ID
step("检查/创建 Bundle ID")
data = req("GET", f"/bundleIds?filter[identifier]={BUNDLE_ID}&limit=200")["data"]
bid = next((b for b in data if b["attributes"]["identifier"]==BUNDLE_ID), None)
if bid:
    ok(f"Bundle ID 已存在: {bid['id']}")
else:
    body = {"data":{"type":"bundleIds","attributes":{
            "identifier":BUNDLE_ID,"name":"Vxin","platform":"IOS"}}}
    bid = req("POST","/bundleIds",json=body)["data"]
    ok(f"已创建 Bundle ID: {bid['id']}")
BID_ID = bid["id"]

# 2) 证书
step("申请 Apple Distribution 证书")
with open(CSR_PATH) as f: csr = f.read().strip()
certs = req("GET", f"/certificates?filter[certificateType]={CERT_TYPE}&limit=200")["data"]
cert = None
if certs:
    cert = certs[0]; ok(f"复用已有证书: {cert['id']}")
else:
    body = {"data":{"type":"certificates","attributes":{
            "certificateType":CERT_TYPE,"csrContent":csr}}}
    cert = req("POST","/certificates",json=body)["data"]
    ok(f"已签发新证书: {cert['id']}")
CERT_ID = cert["id"]
cer_der = base64.b64decode(cert["attributes"]["certificateContent"])
with open(os.path.join(SIGN_DIR,"distribution.cer"),"wb") as f: f.write(cer_der)
ok("已保存 distribution.cer")

# 3) 描述文件
step("生成 App Store 描述文件")
profs = req("GET", f"/profiles?filter[name]={PROFILE_NAME}&limit=200")["data"]
for p in profs:                       # 删旧的，避免证书不匹配
    req("DELETE", f"/profiles/{p['id']}"); print(f"  删除旧描述文件 {p['id']}")
body = {"data":{"type":"profiles","attributes":{
        "name":PROFILE_NAME,"profileType":PROFILE_TYPE},
        "relationships":{
          "bundleId":{"data":{"type":"bundleIds","id":BID_ID}},
          "certificates":{"data":[{"type":"certificates","id":CERT_ID}]}}}}
prof = req("POST","/profiles",json=body)["data"]
prof_der = base64.b64decode(prof["attributes"]["profileContent"])
PROFILE_OUT = os.path.join(SIGN_DIR, f"{PROFILE_NAME}.mobileprovision")
with open(PROFILE_OUT,"wb") as f: f.write(prof_der)
ok(f"已生成描述文件: {PROFILE_OUT}")

# 4) 合成 p12（openssl，无需 Mac）
step("合成 distribution.p12")
pem = os.path.join(SIGN_DIR,"distribution.pem")
subprocess.run(["openssl","x509","-inform","DER","-in",
                os.path.join(SIGN_DIR,"distribution.cer"),"-out",pem],check=True)
P12_OUT = os.path.join(SIGN_DIR,"distribution.p12")
subprocess.run(["openssl","pkcs12","-export","-legacy",
                "-inkey",KEY_PATH,"-in",pem,"-out",P12_OUT,
                "-passout",f"pass:{P12_PW}"],check=True)
ok(f"已合成: {P12_OUT} (密码={P12_PW})")

# 5) 写 GitHub Secrets
step("写入 GitHub Secrets")
def b64f(p):
    with open(p,"rb") as f: return base64.b64encode(f.read()).decode()
def gh_secret(name,val):
    subprocess.run(["gh","secret","set",name,"--body",val],check=True)
    print(f"  set {name}")
gh_secret("IOS_CERTIFICATE_P12_BASE64",      b64f(P12_OUT))
gh_secret("IOS_CERTIFICATE_PASSWORD",        P12_PW)
gh_secret("IOS_PROVISIONING_PROFILE_BASE64", b64f(PROFILE_OUT))
gh_secret("IOS_KEYCHAIN_PASSWORD",           KEYCHAIN_PW)
gh_secret("ASC_KEY_ID",                      KEY_ID)
gh_secret("ASC_ISSUER_ID",                   ISSUER_ID)
gh_secret("ASC_API_KEY_BASE64",              b64f(P8_PATH))

print("\n🎉 全部完成！下一步触发发版：")
print("   gh workflow run ios-testflight.yml --ref master -f version=1.0.10")
