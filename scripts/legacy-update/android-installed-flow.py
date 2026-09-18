#!/usr/bin/env python3
"""Exercise an unmodified historical signed APK through its real update UI.

Only disposable, rooted emulators are accepted. Account API fixtures stay
on loopback; update discovery/download/TLS use the historical production URL.
No new APK is installed with adb: PackageInstaller must perform that upgrade.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
import urllib.request
import xml.etree.ElementTree as ET

PACKAGE = 'com.touliao.app'
USER = {'id': 'upgrade-user', 'username': 'UpgradeProbe', 'phone': '13900000001', 'wechat_id': 'upgradeprobe'}
TOKEN = 'isolated-upgrade-account-not-a-production-token'
MESSAGE = 'LEGACY-CACHED-MESSAGE-MUST-SURVIVE'
STATE = {'historyOffline': False, 'requests': [], 'loginCount': 0}
conversation = {'id': 'legacy-chat', 'type': 'private', 'name': 'LegacyPeer', 'lastMessage': 'Open cached history',
                'lastTime': 1789747200, 'otherUser': {'id': 'legacy-peer', 'username': 'LegacyPeer'}}
message = {'id': 'legacy-message', 'conversation_id': 'legacy-chat', 'sender_id': 'legacy-peer',
           'senderName': 'LegacyPeer', 'content': MESSAGE, 'type': 'text', 'created_at': 1789747100, 'server_sequence': 1}


class Fixture(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        self.do_GET()

    def do_GET(self):
        p = urlparse(self.path).path
        if self.command == 'POST':
            self.rfile.read(int(self.headers.get('Content-Length', 0)))
        authenticated = self.headers.get('Authorization') == 'Bearer ' + TOKEN
        STATE['requests'].append({'method': self.command, 'path': p, 'authenticated': authenticated,
                                  'historyOffline': STATE['historyOffline']})
        status, body = 200, {}
        if p == '/api/auth/login':
            STATE['loginCount'] += 1
            body = {'token': TOKEN, 'user': USER}
        elif p in ['/api/auth/me', '/api/users/me']:
            status, body = (200, USER) if authenticated else (401, {'error': 'Test session absent'})
        elif p == '/api/config':
            body = {'features': {'loginCaptcha': False, 'wallet': False}}
        elif p == '/api/messages/conversations':
            body = [conversation]
        elif p == '/api/messages/legacy-chat':
            status, body = (503, {'error': 'History deliberately offline'}) if STATE['historyOffline'] else (200, [message])
        elif p == '/api/messages/legacy-chat/sync':
            status, body = (503, {}) if STATE['historyOffline'] else (200, {'messages': [message], 'cursor': 1, 'hasMore': False})
        elif p.endswith('/read-states'):
            body = {'states': {}}
        elif p.endswith('/info'):
            body = {'name': 'LegacyPeer', 'members': [USER, {'id': 'legacy-peer', 'username': 'LegacyPeer'}]}
        elif p == '/api/users/legacy-peer':
            body = {'id': 'legacy-peer', 'username': 'LegacyPeer'}
        elif any(x in p for x in ['contacts', 'pinned-messages', 'friend-requests', 'my-groups', 'collections', 'sessions']):
            body = []
        elif p.startswith('/socket.io'):
            status = 503  # No simulated realtime/call success is claimed.
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def adb(*args, binary=False, check=True):
    r = subprocess.run(['adb', *args], capture_output=True, check=check, timeout=60)
    return r.stdout if binary else r.stdout.decode(errors='replace').replace('\r', '').strip()


def shell(command):
    return adb('shell', command)


def tree():
    adb('shell', 'uiautomator dump /sdcard/legacy-update-window.xml', check=False)
    raw = adb('exec-out', 'cat', '/sdcard/legacy-update-window.xml')
    return raw, list(ET.fromstring(raw).iter('node'))


def find_node(texts=(), resource=None, timeout=45):
    end = time.time() + timeout
    while time.time() < end:
        try:
            _, nodes = tree()
            for n in nodes:
                if (resource and n.get('resource-id', '').endswith(resource)) or (
                        texts and (n.get('text') in texts or n.get('content-desc') in texts)):
                    return n
        except (ET.ParseError, subprocess.CalledProcessError):
            pass
        time.sleep(1)
    raise AssertionError(f'UI element absent: {texts} / {resource}')


def click(texts=(), resource=None, timeout=45):
    n = find_node(texts, resource, timeout)
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', n.get('bounds')))
    adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))


def capture(out, name):
    raw, _ = tree()
    (out / (name + '.xml')).write_text(raw)
    (out / (name + '.png')).write_bytes(adb('exec-out', 'screencap', '-p', binary=True))


def click_scrolling(texts):
    for attempt in range(6):
        try:
            click(texts=texts, timeout=3)
            return
        except AssertionError:
            _, nodes = tree()
            scroll = next(n for n in nodes if n.get('scrollable') == 'true')
            x1, y1, x2, y2 = map(int, re.findall(r'\d+', scroll.get('bounds')))
            x = (x1 + x2) // 2
            adb('shell', 'input', 'swipe', str(x), str(y1 + (y2-y1)*3//4), str(x), str(y1 + (y2-y1)//4), '450')
    raise AssertionError(f'UI item not found after scrolling: {texts}')


def installed():
    text = shell('dumpsys package ' + PACKAGE)
    return {'versionCode': int(re.search(r'versionCode=(\d+)', text)[1]),
            'versionName': re.search(r'versionName=([^\s]+)', text)[1],
            'firstInstallTime': re.search(r'firstInstallTime=([^\n]+)', text)[1],
            'uid': shell('stat -c %u /data/user/0/' + PACKAGE)}


def start():
    adb('shell', 'am', 'start', '-W', '-n', PACKAGE + '/.MainActivity')


def restart():
    adb('shell', 'am', 'force-stop', PACKAGE)
    start()


def profile_update():
    click(resource='nav-tab-me')
    # The historical profile screen checks for updates and opens the real dialog.
    find_node(texts=('发现新版本 8.1.25',))


def run(args, report):
    out = args.output
    assert shell('getprop ro.kernel.qemu') == '1', 'Only disposable emulator allowed'
    adb('root'); adb('wait-for-device')
    api = int(shell('getprop ro.build.version.sdk'))
    report['environment'] = f'Android API {api} native emulator'
    report['buildFingerprint'] = shell('getprop ro.build.fingerprint')
    manifest = json.load(urllib.request.urlopen('https://touliao.cc/downloads/touliao-android-version.json', timeout=30))
    assert (manifest['versionName'], manifest['versionCode']) == ('8.1.25', 82), 'Publication changed; re-audit before testing'
    (out / 'public-manifest.json').write_text(json.dumps(manifest, indent=2))
    adb('install', str(args.old_apk))
    if api >= 33:
        # Keep notification prompts out of the update exercise; this grants no
        # installation permission and does not change the updater or its checks.
        adb('shell', 'pm', 'grant', PACKAGE, 'android.permission.POST_NOTIFICATIONS', check=False)
    before = installed(); report['before'] = before
    assert before['versionCode'] < 82
    # Configure the supported manual server override before first launch. This
    # touches no application code or credentials. Login itself uses the old UI.
    prefs = out / 'vxin_server.xml'
    prefs.write_text('<?xml version="1.0" encoding="utf-8"?><map><string name="base_url_override">http://127.0.0.1:18765</string></map>')
    adb('reverse', 'tcp:18765', 'tcp:18765')
    adb('push', str(prefs), '/data/local/tmp/legacy-server.xml')
    shell(f'mkdir -p /data/user/0/{PACKAGE}/shared_prefs; cp /data/local/tmp/legacy-server.xml /data/user/0/{PACKAGE}/shared_prefs/vxin_server.xml; chown -R {before["uid"]}:{before["uid"]} /data/user/0/{PACKAGE}/shared_prefs; restorecon -R /data/user/0/{PACKAGE}/shared_prefs')
    start()
    click(resource='login-phone-input'); adb('shell', 'input', 'text', USER['phone'])
    click(resource='login-password-input'); adb('shell', 'input', 'text', 'isolated-only')
    adb('shell', 'input', 'keyevent', '4')
    click(resource='login-submit-btn')
    click(texts=('LegacyPeer',)); find_node(texts=(MESSAGE,))
    capture(out, '01-old-authenticated-history')
    time.sleep(2)  # allow the old client's own encrypted cache write to finish
    adb('shell', 'input', 'keyevent', '4')
    profile_update(); capture(out, '02-old-discovers-production-update')
    click(texts=('稍后',))
    click_scrolling(('设置',))
    # Fail the real historical network request, then recover using the same UI.
    uid = before['uid']
    shell(f'iptables -I OUTPUT -m owner --uid-owner {uid} -j REJECT')
    try:
        click(texts=('检查更新',)); find_node(texts=('更新失败',), timeout=90)
        capture(out, '03-check-offline-failure')
    finally:
        shell(f'iptables -D OUTPUT -m owner --uid-owner {uid} -j REJECT')
    click(texts=('确定',)); click(texts=('检查更新',))
    find_node(texts=('发现新版本 8.1.25',)); capture(out, '04-check-recovered')
    report['discoveryAndNetworkRecovery'] = 'passed'
    click(texts=('更新',))
    find_node(texts=('需要安装权限',), timeout=240)
    capture(out, '05-download-complete-permission-required')
    remote_apk = f'/sdcard/Android/data/{PACKAGE}/files/downloads/vxin-update.apk'
    digest = shell('sha256sum ' + remote_apk).split()[0]
    assert digest == manifest['sha256'], 'Client-downloaded bytes differ from public manifest'
    report['downloadedSha256'] = digest
    # Controlled corruption of the emulator's cached installer only. Substituting
    # the genuine old APK must be rejected against manifest versionCode 82.
    adb('push', str(args.old_apk), '/data/local/tmp/legacy-old.apk')
    shell('cp /data/local/tmp/legacy-old.apk ' + remote_apk)
    click(texts=('去授权',))
    click(resource='switch_widget')
    adb('shell', 'input', 'keyevent', '4')
    find_node(texts=('⚠️ 安装包校验未通过',), timeout=60)
    capture(out, '06-cached-wrong-version-blocked')
    assert installed()['versionCode'] == before['versionCode']
    assert shell('test -e ' + remote_apk + '; echo $?') == '1', 'Rejected installer was not removed'
    report['cachedWrongVersionRejectedAndRemoved'] = True
    click(texts=('我知道了',)); click(texts=('检查更新',)); click(texts=('更新',))
    find_node(texts=('Install', '安装', 'INSTALL', 'Update', 'UPDATE'), timeout=240)
    capture(out, '07-system-installer-before-upgrade')
    click(texts=('Cancel', '取消', 'CANCEL'))
    assert installed()['versionCode'] == before['versionCode']
    report['cancelPreservesOldInstallation'] = True
    # Reopen the same installed old app, retaining its real encrypted credentials.
    restart(); profile_update(); click(texts=('更新',))
    find_node(texts=('Install', '安装', 'INSTALL', 'Update', 'UPDATE'), timeout=240)
    click(texts=('Install', '安装', 'INSTALL', 'Update', 'UPDATE'))
    deadline = time.time() + 120
    while time.time() < deadline and installed()['versionCode'] != 82:
        time.sleep(2)
    after = installed(); report['after'] = after
    assert after['versionCode'] == 82 and after['versionName'] == '8.1.25'
    assert after['uid'] == before['uid'] and after['firstInstallTime'] == before['firstInstallTime']
    capture(out, '08-system-installer-completed')
    STATE['historyOffline'] = True
    start()
    click(texts=('LegacyPeer',)); find_node(texts=(MESSAGE,))
    capture(out, '09-new-ui-offline-history-retained')
    assert STATE['loginCount'] == 1, 'Upgrade required another login'
    assert any(x['path'] == '/api/auth/me' and x['authenticated'] and x['historyOffline'] for x in STATE['requests'])
    report.update({'nativeSystemInstallerUpgrade': 'passed', 'isolatedAccountSessionRestored': True,
                   'encryptedOfflineHistoryRenderedWithoutServerHistory': True,
                   'sameApplicationUidAndFirstInstallTime': True, 'loginCount': STATE['loginCount'], 'passed': True})


def main():
    p = argparse.ArgumentParser(); p.add_argument('--old-apk', type=Path, required=True); p.add_argument('--output', type=Path, required=True)
    args = p.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    report = {'environment': 'Android native emulator (API recorded after connection)', 'unmodifiedHistoricalApk': True,
              'physicalDevice': False, 'productionAccountTested': False, 'testAccountApi': 'isolated loopback fixture',
              'updateNetwork': 'unchanged historical production HTTPS endpoint', 'hotUpdate': False, 'passed': False}
    server = ThreadingHTTPServer(('127.0.0.1', 18765), Fixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        run(args, report)
    except Exception as e:
        report['error'] = str(e)
        try: capture(args.output, 'failure')
        except Exception: pass
        raise
    finally:
        (args.output / 'result.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
        (args.output / 'fixture-requests.json').write_text(json.dumps(STATE['requests'], indent=2) + '\n')
        (args.output / 'logcat.txt').write_text(adb('logcat', '-d', check=False))
        server.shutdown()


if __name__ == '__main__':
    main()
