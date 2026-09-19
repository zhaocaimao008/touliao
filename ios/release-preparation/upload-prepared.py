"""Verify/upload an approved IPA; optional internal group setup, never review submission."""
import base64
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

import jwt

ROOT = Path(os.environ['UPLOAD_DIR'])
EVIDENCE = ROOT / 'evidence'
PRIVATE = ROOT / 'private'
PREPARED = ROOT / 'prepared'
VERSION = os.environ['APP_VERSION']
BUILD = os.environ['BUILD_NUMBER']
BUNDLE = 'com.touliao.app'
TEAM = 'F2J52VX786'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def save(name, value):
    (EVIDENCE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def export_env(name, value):
    require('\n' not in value and '\r' not in value, 'Invalid environment value')
    with open(os.environ['GITHUB_ENV'], 'a') as output:
        output.write(name + '=' + value + '\n')


def key_path():
    return PRIVATE / 'api-keys' / ('AuthKey_' + os.environ['ASC_KEY_ID'] + '.p8')


def verify():
    require(re.fullmatch(r'\d+\.\d+\.\d+', VERSION), 'Invalid marketing version')
    require(re.fullmatch(r'\d+', BUILD), 'Invalid build number')
    run = json.loads((EVIDENCE / 'source-run.json').read_text())
    require(run['conclusion'] == 'success' and run['workflowName'] == 'iOS TestFlight', 'Source preparation run did not pass')
    source = (PREPARED / 'source-commit.txt').read_text().strip()
    require(source == run['headSha'] and re.fullmatch(r'[a-f0-9]{40}', source), 'Artifact source commit mismatch')
    subprocess.run(['git', 'fetch', '--no-tags', '--depth=1', 'origin', source], check=True)
    subprocess.run(['git', 'diff', '--exit-code', source, 'HEAD', '--', 'ios/Touliao', 'ios/TouliaoTests', 'ios/project.yml', 'scripts/native-review'], check=True)
    evidence = json.loads((PREPARED / 'ipa-validation.json').read_text())
    apple = json.loads((PREPARED / 'apple-validation.json').read_text())
    require(evidence['signatureVerified'] and evidence['certificateMatchesProfile'] and apple['appleValidationPassed'], 'Original IPA validation incomplete')
    ipas = list((PREPARED / 'export').glob('*.ipa'))
    require(len(ipas) == 1, 'Expected one IPA')
    ipa = ipas[0]
    digest = hashlib.sha256(ipa.read_bytes()).hexdigest()
    require(digest == os.environ['EXPECTED_IPA_SHA256'] == evidence['ipaSha256'], 'IPA differs from the approved artifact')
    with zipfile.ZipFile(ipa) as package:
        info = plistlib.loads(package.read('Payload/Touliao.app/Info.plist'))
    require(info['CFBundleIdentifier'] == BUNDLE == evidence['bundleId'], 'Bundle identifier mismatch')
    require(info['CFBundleShortVersionString'] == VERSION == evidence['version'], 'Marketing version mismatch')
    require(info['CFBundleVersion'] == BUILD == evidence['buildNumber'], 'Build number mismatch')
    extracted = PRIVATE / 'extracted'
    subprocess.run(['ditto', '-x', '-k', str(ipa), str(extracted)], check=True)
    app = extracted / 'Payload/Touliao.app'
    verified = subprocess.run(['codesign', '--verify', '--deep', '--strict', '--verbose=2', str(app)], check=True, capture_output=True, text=True)
    (EVIDENCE / 'signature-check.log').write_text(verified.stdout + verified.stderr)
    ent = plistlib.loads(subprocess.check_output(['codesign', '-d', '--entitlements', ':-', str(app)]))
    require(ent == evidence['entitlements'], 'IPA entitlements differ from original validation')
    require(ent.get('application-identifier') == TEAM + '.' + BUNDLE and ent.get('aps-environment') == 'production' and ent.get('get-task-allow') is False, 'Unexpected distribution entitlements')
    for name in ['ASC_API_KEY_BASE64', 'ASC_KEY_ID', 'ASC_ISSUER_ID']:
        require(bool(os.environ.get(name)), 'Missing ' + name)
    key_path().parent.mkdir(parents=True, exist_ok=True)
    key_path().write_bytes(base64.b64decode(os.environ['ASC_API_KEY_BASE64'], validate=True))
    export_env('IPA_PATH', str(ipa))
    save('approved-ipa.json', {'sourceRun': os.environ['PREPARED_RUN_ID'], 'sourceCommit': source, 'bundleId': BUNDLE, 'version': VERSION, 'buildNumber': BUILD, 'ipaSha256': digest, 'signatureVerified': True, 'submittedForReview': False})
    print('Approved IPA identity, hash and signature verified.')


def get(resource, params=None):
    token = jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': int(time.time()), 'exp': int(time.time()) + 600, 'aud': 'appstoreconnect-v1'}, key_path().read_bytes(), algorithm='ES256', headers={'kid': os.environ['ASC_KEY_ID']})
    url = 'https://api.appstoreconnect.apple.com/v1/' + resource
    if params:
        url += '?' + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token}, method='GET')
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def build_status():
    apps = get('apps', {'filter[bundleId]': BUNDLE, 'limit': 2})['data']
    require(len(apps) == 1, 'Expected App Store Connect app not accessible')
    app_id = apps[0]['id']
    response = get('builds', {'filter[app]': app_id, 'filter[version]': BUILD, 'include': 'preReleaseVersion,buildBetaDetail,betaGroups', 'limit': 20})
    versions = {r['id']: r['attributes'] for r in response.get('included', []) if r['type'] == 'preReleaseVersions'}
    details = {r['id']: r['attributes'] for r in response.get('included', []) if r['type'] == 'buildBetaDetails'}
    builds = [b for b in response['data'] if b['attributes']['version'] == BUILD]
    require(len(builds) <= 1, 'Ambiguous App Store Connect build match')
    result = {'appId': app_id, 'bundleId': BUNDLE, 'version': VERSION, 'buildNumber': BUILD, 'found': bool(builds), 'processingState': 'NOT_VISIBLE', 'submittedForReviewByThisRun': False}
    if builds:
        build = builds[0]
        relation = build['relationships']['preReleaseVersion']['data']['id']
        require(versions[relation]['version'] == VERSION and versions[relation]['platform'] == 'IOS', 'Existing build belongs to a different version or platform')
        beta_relation = build['relationships'].get('buildBetaDetail', {}).get('data')
        detail = details.get(beta_relation['id'], {}) if beta_relation else {}
        attrs = build['attributes']
        group_ids = [g['id'] for g in build['relationships'].get('betaGroups', {}).get('data', [])]
        result.update({'buildId': build['id'], 'processingState': attrs['processingState'], 'uploadedDate': attrs.get('uploadedDate'), 'expired': attrs.get('expired'), 'usesNonExemptEncryption': attrs.get('usesNonExemptEncryption'), 'betaBuildDetail': detail, 'assignedBetaGroupIds': group_ids})
        require(attrs['processingState'] not in ['INVALID', 'FAILED'], 'Apple rejected the exact build: ' + attrs['processingState'])
        require(not attrs.get('expired'), 'Exact build has expired')
    return result


def testing_access(status):
    groups = get('apps/' + status['appId'] + '/betaGroups', {'limit': 200})['data']
    assigned_ids = set(status['assignedBetaGroupIds'])
    result = []
    for group in groups:
        attrs = group['attributes']
        item = {'id': group['id'], 'name': attrs.get('name'), 'isInternalGroup': attrs.get('isInternalGroup'), 'hasAccessToAllBuilds': attrs.get('hasAccessToAllBuilds'), 'assignedToThisBuild': group['id'] in assigned_ids, 'publicLinkEnabled': attrs.get('publicLinkEnabled'), 'publicLink': attrs.get('publicLink') if attrs.get('publicLinkEnabled') else None}
        if attrs.get('isInternalGroup'):
            testers = get('betaGroups/' + group['id'] + '/betaTesters', {'limit': 1})
            item['testerCount'] = testers.get('meta', {}).get('paging', {}).get('total', len(testers['data']))
        result.append(item)
    save('testing-access.json', {'appId': status['appId'], 'buildId': status['buildId'], 'version': VERSION, 'buildNumber': BUILD, 'groups': result, 'testersInvited': False})


def prepare_internal_testing(status):
    name = 'iOS 最新 UI 验收'
    groups = get('apps/' + status['appId'] + '/betaGroups', {'limit': 200})['data']
    matches = [g for g in groups if g['attributes'].get('isInternalGroup') is True and g['attributes']['name'] == name]
    require(len(matches) <= 1, 'Ambiguous internal acceptance group')

    def post(resource, body):
        require(resource == 'betaGroups' or re.fullmatch(r'betaGroups/[a-fA-F0-9-]+/relationships/builds', resource), 'Only internal group creation/build assignment is allowed')
        token = jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': int(time.time()), 'exp': int(time.time()) + 600, 'aud': 'appstoreconnect-v1'}, key_path().read_bytes(), algorithm='ES256', headers={'kid': os.environ['ASC_KEY_ID']})
        request = urllib.request.Request('https://api.appstoreconnect.apple.com/v1/' + resource, data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(request, timeout=45) as response:
            content = response.read()
            return json.loads(content) if content else {}

    group = matches[0] if matches else post('betaGroups', {'data': {'type': 'betaGroups', 'attributes': {'name': name, 'isInternalGroup': True}, 'relationships': {'app': {'data': {'type': 'apps', 'id': status['appId']}}}}})['data']
    require(group['attributes']['isInternalGroup'] is True, 'Expected an internal testing group')
    if group['id'] not in status['assignedBetaGroupIds']:
        post('betaGroups/' + group['id'] + '/relationships/builds', {'data': [{'type': 'builds', 'id': status['buildId']}]})
    for _ in range(10):
        updated = build_status()
        if group['id'] in updated['assignedBetaGroupIds']:
            save('internal-group-setup.json', {'groupId': group['id'], 'groupName': name, 'buildId': status['buildId'], 'buildNumber': BUILD, 'buildAssigned': True, 'testersInvited': False, 'submittedForReview': False})
            return updated
        time.sleep(2)
    raise RuntimeError('Internal group assignment was not visible after verification')


if __name__ == '__main__':
    stage = sys.argv[1]
    if stage == 'verify':
        verify()
    elif stage == 'check':
        status = build_status()
        save('before-upload.json', status)
        export_env('SKIP_IPA_UPLOAD', 'true' if status['found'] else 'false')
        print('Exact build status before upload: ' + status['processingState'])
    elif stage == 'wait':
        deadline = time.monotonic() + 1200
        while True:
            try:
                status = build_status()
            except urllib.error.HTTPError as error:
                if error.code not in [429, 500, 502, 503, 504]:
                    raise
                status = {'processingState': 'API_TEMPORARILY_UNAVAILABLE', 'httpStatus': error.code}
            save('processing-status.json', status)
            print('Build ' + BUILD + ': ' + status['processingState'], flush=True)
            if status['processingState'] == 'VALID':
                if os.environ.get('PREPARE_INTERNAL_TESTING') == 'true':
                    status = prepare_internal_testing(status)
                save('testflight-receipt.json', status)
                testing_access(status)
                break
            require(time.monotonic() < deadline, 'Apple processing did not complete within 20 minutes; no duplicate upload attempted')
            time.sleep(30)
    else:
        raise ValueError('Unknown stage')
