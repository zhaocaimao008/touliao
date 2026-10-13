#!/usr/bin/env python3
"""从 `xcrun simctl list devices available -j` 里确定性地选一台 iPhone 模拟器（打印 UDID）。

规则：取最新的 iOS 运行时，在其中优先选固定机型（PREFERRED 顺序），都没有则取该运行时最后一台 iPhone。
ios-build.yml 的 Xcode 26 测试任务与 ios-v tag 发版前的测试门禁（run.sh simulator）都走这里，
保证两处在同一种机型/系统上跑 TouliaoTests（含截图校验）。
"""
import json
import re
import sys

PREFERRED = ("iPhone 17 Pro", "iPhone 16 Pro", "iPhone 17", "iPhone 16", "iPhone 15 Pro")


def runtime_version(key):
    m = re.search(r"iOS-(\d+)-(\d+)(?:-(\d+))?", key)
    return tuple(int(x or 0) for x in m.groups()) if m else None


def pick(devices):
    runtimes = []
    for key, items in devices.items():
        ver = runtime_version(key)
        phones = [d for d in items if d.get("name", "").startswith("iPhone") and d.get("isAvailable", True)]
        if ver is not None and phones:
            runtimes.append((ver, key, phones))
    if not runtimes:
        raise SystemExit("No iPhone simulator")
    ver, key, phones = max(runtimes, key=lambda r: r[0])
    by_name = {d["name"]: d for d in phones}
    chosen = next((by_name[n] for n in PREFERRED if n in by_name), phones[-1])
    print(f"Simulator: {chosen['name']} / {key}", file=sys.stderr)
    return chosen["udid"]


if __name__ == "__main__":
    print(pick(json.load(sys.stdin)["devices"]))
