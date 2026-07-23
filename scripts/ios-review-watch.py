#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
轮询 TestFlight 外部 Beta 审核状态，状态变化时记日志并可选 Telegram 推送。
适合放 cron（每 15 分钟）。状态存 /root/v信/.ios-review-last，日志 /root/v信/.ios-review.log。
Telegram：在 /root/.vxin-notify.env 写 TG_BOT_TOKEN=xxx / TG_CHAT_ID=xxx 即启用。
"""
import os, time, json, datetime, jwt, requests

KEY_ID="M2N9T96YN4"; ISSUER="f60701b1-62c3-40ef-9d6e-3f62fc880deb"
P8="/root/AuthKey_M2N9T96YN4.p8"; BUNDLE="com.vxin.app"
API="https://api.appstoreconnect.apple.com/v1"
BASE="/root/v信"; LAST=f"{BASE}/.ios-review-last"; LOG=f"{BASE}/.ios-review.log"
NOTIFY_ENV="/root/.vxin-notify.env"

def now(): return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
def log(m):
    line=f"[{now()}] {m}"
    print(line)
    with open(LOG,"a") as f: f.write(line+"\n")

def tok():
    return jwt.encode({"iss":ISSUER,"iat":int(time.time()),"exp":int(time.time())+900,
                       "aud":"appstoreconnect-v1"},open(P8).read(),algorithm="ES256",headers={"kid":KEY_ID})
def H(): return {"Authorization":f"Bearer {tok()}"}

def load_notify():
    d={}
    if os.path.exists(NOTIFY_ENV):
        for ln in open(NOTIFY_ENV):
            ln=ln.strip()
            if "=" in ln and not ln.startswith("#"):
                k,v=ln.split("=",1); d[k.strip()]=v.strip()
    return d

def tg(msg):
    n=load_notify(); t=n.get("TG_BOT_TOKEN"); c=n.get("TG_CHAT_ID")
    if not (t and c): return
    try:
        requests.post(f"https://api.telegram.org/bot{t}/sendMessage",
                      json={"chat_id":c,"text":msg},timeout=15)
    except Exception as e: log(f"TG 发送失败: {e}")

def main():
    app=requests.get(f"{API}/apps?filter[bundleId]={BUNDLE}",headers=H()).json()["data"][0]
    APPID=app["id"]
    builds=requests.get(f"{API}/builds?filter[app]={APPID}&sort=-uploadedDate&limit=1",headers=H()).json()["data"]
    if not builds: log("无构建"); return
    b=builds[0]; bid=b["id"]; ver=b["attributes"]["version"]
    s=requests.get(f"{API}/builds/{bid}/betaAppReviewSubmission",headers=H()).json()
    state=s["data"]["attributes"].get("betaReviewState") if s.get("data") else "NOT_SUBMITTED"
    proc=b["attributes"]["processingState"]
    cur=f"{ver}:{state}"
    prev=open(LAST).read().strip() if os.path.exists(LAST) else ""
    if cur!=prev:
        emoji={"APPROVED":"✅","REJECTED":"❌","WAITING_FOR_REVIEW":"⏳","IN_REVIEW":"🔍"}.get(state,"ℹ️")
        msg=f"{emoji} v信 TestFlight build {ver} 审核状态: {state} (处理={proc})"
        if state=="APPROVED":
            msg+="\n🔗 公开链接: https://testflight.apple.com/join/JQw5bjEz 现已可用！"
        elif state=="REJECTED":
            msg+="\n请到 App Store Connect 查看被拒原因。"
        log(f"状态变化: {prev or '(无)'} → {cur}")
        tg(msg)
        with open(LAST,"w") as f: f.write(cur)
    else:
        log(f"无变化: {cur}")

if __name__=="__main__":
    try: main()
    except Exception as e: log(f"错误: {e}")
