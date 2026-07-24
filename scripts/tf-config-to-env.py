#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""读取 ios/testflight-config.json，输出 `export TF_*=...` 供 shell eval。
原先内嵌在 ios-testflight.yml 的 `run:` heredoc 里，因 heredoc 正文顶格无缩进
破坏了 YAML 块标量缩进 → 每次 push 触发 workflow 文件解析失败（startup_failure）。
抽成独立脚本后 workflow YAML 合法，且逻辑完全一致。"""
import json, shlex

cfg = json.load(open('ios/testflight-config.json'))
m = {
    "feedback_email": "TF_FEEDBACK_EMAIL", "description": "TF_DESCRIPTION",
    "whats_new": "TF_WHATS_NEW", "demo_account": "TF_DEMO_ACCOUNT", "demo_password": "TF_DEMO_PASSWORD",
    "contact_first": "TF_CONTACT_FIRST", "contact_last": "TF_CONTACT_LAST", "contact_email": "TF_CONTACT_EMAIL",
    "contact_phone": "TF_CONTACT_PHONE", "review_notes": "TF_REVIEW_NOTES", "group_name": "TF_GROUP_NAME",
    "mode": "TF_MODE", "locale": "TF_LOCALE", "bundle": "TF_BUNDLE",
}
for k, v in m.items():
    if k in cfg and cfg[k] is not None:
        print(f'export {v}={shlex.quote(str(cfg[k]))}')
