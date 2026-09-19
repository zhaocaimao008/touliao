"""Verify/upload an approved IPA, with opt-in TestFlight group setup or Beta review."""
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


def submit_beta_review():
    require(os.environ.get('PREPARED_BETA_REVIEW') == 'true', 'External Beta review was not requested')
    require(os.environ.get('PREPARE_INTERNAL_TESTING') != 'true', 'Conflicting testing modes')
    status = build_status()
    require(status['processingState'] == 'VALID', 'Exact build is not ready for Beta review')
    require(status['usesNonExemptEncryption'] is False, 'Expected previously verified export compliance')
    approved = json.loads((EVIDENCE / 'approved-ipa.json').read_text())
    require(approved['version'] == VERSION and approved['buildNumber'] == BUILD and approved['signatureVerified'], 'Missing approved artifact evidence')
    config = json.loads(Path('ios/testflight-config.json').read_text())
    require(config['bundle'] == BUNDLE and config['mode'] == 'external', 'Unexpected Beta configuration')
    required = ['locale', 'description', 'feedback_email', 'contact_first', 'contact_last', 'contact_email', 'contact_phone', 'demo_account', 'demo_password', 'review_notes']
    for field in required:
        require(isinstance(config.get(field), str) and bool(config[field].strip()), 'Missing Beta configuration: ' + field)
    app_id, build_id = status['appId'], status['buildId']
    groups = get('apps/' + app_id + '/betaGroups', {'limit': 200})['data']
    matches = [g for g in groups if g['id'] == 'f8ad8b68-76f3-47ee-a8dd-2dc88ecaf4ac']
    require(len(matches) == 1, 'Existing public testing group not found')
    group = matches[0]
    attrs = group['attributes']
    require(attrs.get('isInternalGroup') is False and attrs.get('publicLinkEnabled') is True and attrs.get('publicLink') == 'https://testflight.apple.com/join/JR7seuh6', 'Public testing group configuration changed')

    def write_beta(method, resource, body):
        # This path cannot write App Store release or review resources.
        allowed = ((method == 'POST' and resource in ['betaAppLocalizations', 'betaBuildLocalizations', 'betaAppReviewDetails', 'betaAppReviewSubmissions'])
                   or (method == 'PATCH' and re.fullmatch(r'(betaAppLocalizations|betaBuildLocalizations|betaAppReviewDetails)/[a-zA-Z0-9-]+', resource))
                   or (method == 'POST' and resource == 'betaGroups/' + group['id'] + '/relationships/builds'))
        require(allowed, 'Only TestFlight Beta metadata, group assignment and review are permitted')
        token = jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': int(time.time()), 'exp': int(time.time()) + 600, 'aud': 'appstoreconnect-v1'}, key_path().read_bytes(), algorithm='ES256', headers={'kid': os.environ['ASC_KEY_ID']})
        request = urllib.request.Request('https://api.appstoreconnect.apple.com/v1/' + resource, data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method=method)
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                content = response.read()
                return json.loads(content) if content else {}
        except urllib.error.HTTPError as error:
            # Keep credentials and reviewer contact data out of logs/artifacts.
            details = json.loads(error.read()).get('errors', [])
            safe = [{'code': e.get('code'), 'status': e.get('status'), 'source': e.get('source')} for e in details]
            save('beta-review-error.json', {'method': method, 'resource': resource, 'httpStatus': error.code, 'errors': safe})
            raise RuntimeError('TestFlight Beta API rejected ' + resource + ': ' + str(error.code) + ' ' + str([e['code'] for e in safe])) from None

    def upsert(resource_type, current, attributes, parent_name, parent_type, parent_id):
        if current:
            return write_beta('PATCH', resource_type + '/' + current['id'], {'data': {'type': resource_type, 'id': current['id'], 'attributes': attributes}})
        return write_beta('POST', resource_type, {'data': {'type': resource_type, 'attributes': attributes, 'relationships': {parent_name: {'data': {'type': parent_type, 'id': parent_id}}}}})

    def submission():
        results = get('betaAppReviewSubmissions', {'filter[build]': build_id, 'include': 'build', 'limit': 10})['data']
        require(len(results) <= 1, 'Ambiguous Beta review submission')
        if results:
            require(results[0]['relationships']['build']['data']['id'] == build_id, 'Beta review references the wrong build')
        return results[0] if results else None

    existing = submission()
    require(not existing or existing['attributes']['betaReviewState'] != 'REJECTED', 'The exact build has a rejected Beta review; review feedback must be addressed')
    if not existing:
        localizations = get('apps/' + app_id + '/betaAppLocalizations', {'limit': 200})['data']
        current = next((r for r in localizations if r['attributes']['locale'] == config['locale']), None)
        app_attrs = {'description': config['description'], 'feedbackEmail': config['feedback_email']}
        upsert('betaAppLocalizations', current, app_attrs if current else dict(app_attrs, locale=config['locale']), 'app', 'apps', app_id)
        for item in localizations:
            if item != current and not (item['attributes'].get('description') or '').strip():
                upsert('betaAppLocalizations', item, app_attrs, 'app', 'apps', app_id)

        localizations = get('builds/' + build_id + '/betaBuildLocalizations', {'limit': 200})['data']
        current = next((r for r in localizations if r['attributes']['locale'] == config['locale']), None)
        whats_new = ('最新 iOS UI 真机验收：请测试登录注册、单聊群聊、中文输入与键盘、图片/视频/语音/文件收发与预览、消息撤回/删除/回复/引用/转发、好友与群管理、前后台与锁屏恢复、断网重连、音视频通话、来电接听挂断、扬声器与静音、不同尺寸屏幕和 Safe Area、第三方文件打开与分享。')
        build_attrs = {'whatsNew': whats_new}
        upsert('betaBuildLocalizations', current, build_attrs if current else dict(build_attrs, locale=config['locale']), 'build', 'builds', build_id)

        try:
            current = get('apps/' + app_id + '/betaAppReviewDetail').get('data')
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            current = None
        review_attrs = {'contactFirstName': config['contact_first'], 'contactLastName': config['contact_last'], 'contactEmail': config['contact_email'], 'contactPhone': config['contact_phone'], 'demoAccountRequired': True, 'demoAccountName': config['demo_account'], 'demoAccountPassword': config['demo_password'], 'notes': config['review_notes']}
        upsert('betaAppReviewDetails', current, review_attrs, 'app', 'apps', app_id)
        print('Beta description, test instructions and existing reviewer account details configured.', flush=True)

    if group['id'] not in status['assignedBetaGroupIds']:
        write_beta('POST', 'betaGroups/' + group['id'] + '/relationships/builds', {'data': [{'type': 'builds', 'id': build_id}]})
    existing = submission()
    created = False
    if not existing:
        write_beta('POST', 'betaAppReviewSubmissions', {'data': {'type': 'betaAppReviewSubmissions', 'relationships': {'build': {'data': {'type': 'builds', 'id': build_id}}}}})
        created = True
    for _ in range(12):
        review = submission()
        updated = build_status()
        if review and group['id'] in updated['assignedBetaGroupIds']:
            review_attrs = review['attributes']
            receipt = {'appId': app_id, 'buildId': build_id, 'bundleId': BUNDLE, 'version': VERSION, 'buildNumber': BUILD, 'submissionId': review['id'], 'betaReviewState': review_attrs['betaReviewState'], 'submittedDate': review_attrs.get('submittedDate'), 'createdSubmissionByThisRun': created, 'groupId': group['id'], 'publicLink': attrs['publicLink'], 'buildAssigned': True, 'ipaSha256': approved['ipaSha256'], 'appStoreReleaseSubmitted': False}
            save('beta-review-receipt.json', receipt)
            updated['submittedForReviewByThisRun'] = created
            save('testflight-receipt.json', updated)
            testing_access(updated)
            print('Verified TestFlight Beta review: ' + receipt['betaReviewState'], flush=True)
            require(receipt['betaReviewState'] in ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'APPROVED'], 'Beta review is not pending or approved')
            return
        time.sleep(5)
    raise RuntimeError('Could not verify Beta submission and public group assignment')


if __name__ == '__main__':
    stage = sys.argv[1]
    if stage == 'verify':
        verify()
    elif stage == 'check':
        status = build_status()
        save('before-upload.json', status)
        export_env('SKIP_IPA_UPLOAD', 'true' if status['found'] else 'false')
        print('Exact build status before upload: ' + status['processingState'])
    elif stage == 'beta-review':
        submit_beta_review()
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
