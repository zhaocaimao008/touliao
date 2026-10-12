#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ios-appstore-submit.py 的单测：urllib 传输层全部替换成内存里的假 App Store Connect，
绝不访问真实 API。运行：python3 scripts/test-ios-appstore-submit.py"""
import copy
import importlib.util
import io
import json
import os
import unittest
import urllib.error
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ios_appstore_submit", os.path.join(HERE, "ios-appstore-submit.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

APP = "APP1"
WHATS_NEW = {"zh-Hans": "聊天图片加载更快、显示更清晰", "default": "Sharper chat images"}


class FakeResponse:
    def __init__(self, payload):
        self.raw = json.dumps(payload).encode() if payload is not None else b""

    def read(self):
        return self.raw

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeASC:
    """按路径路由的假 ASC，状态可变，记录每个请求。"""

    def __init__(self, versions=(), builds=None, attached=None, localizations=None, review_detail=True,
                 submissions=(), fail_first_get=None):
        self.calls = []
        self.versions = [copy.deepcopy(v) for v in versions]
        self.builds = builds if builds is not None else [build("B41", "1760000000", "VALID")]
        self.attached = dict(attached or {})
        self.localizations = localizations if localizations is not None else {}
        self.review_detail = review_detail
        self.submissions = [copy.deepcopy(s) for s in submissions]
        self.fail_first_get = fail_first_get
        self.build_polls = 0
        self.counter = 0

    # urllib.request.urlopen 的替身
    def __call__(self, req, timeout=None):
        url = urllib.parse.urlsplit(req.full_url)
        path = url.path.replace("/v1", "", 1)
        query = dict(urllib.parse.parse_qsl(url.query))
        body = json.loads(req.data) if req.data else None
        method = req.get_method()
        self.calls.append((method, path, query, body))
        assert req.headers.get("Authorization") == "Bearer test-token"
        if method == "GET" and self.fail_first_get == path:
            self.fail_first_get = None
            raise urllib.error.HTTPError(req.full_url, 503, "busy", {}, io.BytesIO(b'{"errors":[]}'))
        status, payload = self.route(method, path, query, body)
        if status >= 300:
            raise urllib.error.HTTPError(req.full_url, status, "err", {}, io.BytesIO(json.dumps(payload).encode()))
        return FakeResponse(payload)

    def new_id(self, prefix):
        self.counter += 1
        return f"{prefix}{self.counter}"

    def route(self, method, path, q, body):
        parts = path.strip("/").split("/")
        if method == "GET" and path == "/apps":
            return 200, {"data": [{"id": APP, "type": "apps", "attributes": {"name": "投聊", "bundleId": q["filter[bundleId]"]}}]}
        if method == "GET" and path == "/builds":
            self.build_polls += 1
            data = [b for b in self.builds if b["attributes"]["_marketing"] == q["filter[preReleaseVersion.version]"]]
            if "filter[version]" in q:
                data = [b for b in data if b["attributes"]["version"] == q["filter[version]"]]
            out = []
            for b in data:
                b = copy.deepcopy(b)
                seq = b["attributes"].pop("_states", None)
                if seq:
                    b["attributes"]["processingState"] = seq[min(self.build_polls - 1, len(seq) - 1)]
                b["attributes"].pop("_marketing")
                out.append(b)
            return 200, {"data": out}
        if method == "PATCH" and parts[0] == "builds":
            return 200, {"data": {"id": parts[1], "type": "builds", "attributes": body["data"]["attributes"]}}
        if method == "GET" and path == f"/apps/{APP}/appStoreVersions":
            return 200, {"data": self.versions}
        if method == "POST" and path == "/appStoreVersions":
            vid = self.new_id("V")
            v = {"id": vid, "type": "appStoreVersions", "attributes": dict(body["data"]["attributes"], appVersionState="PREPARE_FOR_SUBMISSION")}
            self.versions.append(v)
            self.localizations.setdefault(vid, [loc("L-zh", "zh-Hans"), loc("L-en", "en-US")])
            return 201, {"data": v}
        if parts[0] == "appStoreVersions" and len(parts) == 2 and method == "PATCH":
            v = next(v for v in self.versions if v["id"] == parts[1])
            v["attributes"].update(body["data"]["attributes"])
            return 200, {"data": v}
        if parts[0] == "appStoreVersions" and parts[2:] == ["relationships", "build"]:
            if method == "GET":
                bid = self.attached.get(parts[1])
                return 200, {"data": {"type": "builds", "id": bid} if bid else None}
            self.attached[parts[1]] = body["data"]["id"]
            return 204, None
        if parts[0] == "appStoreVersions" and parts[2:] == ["appStoreVersionLocalizations"]:
            return 200, {"data": self.localizations.get(parts[1], [])}
        if method == "PATCH" and parts[0] == "appStoreVersionLocalizations":
            for locs in self.localizations.values():
                for item in locs:
                    if item["id"] == parts[1]:
                        item["attributes"].update(body["data"]["attributes"])
            return 200, {"data": {"id": parts[1]}}
        if parts[0] == "appStoreVersions" and parts[2:] == ["appStoreReviewDetail"]:
            return 200, {"data": {"id": "RD1"} if self.review_detail else None}
        if method == "POST" and path == "/appStoreReviewDetails":
            self.review_detail = True
            return 201, {"data": {"id": "RD-new"}}
        if method == "GET" and path == f"/apps/{APP}/reviewSubmissions":
            wanted = q["filter[state]"].split(",")
            return 200, {"data": [{"id": s["id"], "type": "reviewSubmissions", "attributes": {"state": s["state"]}}
                                  for s in self.submissions if s["state"] in wanted]}
        if method == "POST" and path == "/reviewSubmissions":
            sid = self.new_id("S")
            self.submissions.append({"id": sid, "state": "READY_FOR_REVIEW", "items": []})
            return 201, {"data": {"id": sid, "type": "reviewSubmissions", "attributes": {"state": "READY_FOR_REVIEW"}}}
        if method == "GET" and parts[0] == "reviewSubmissions" and parts[2:] == ["items"]:
            s = next(s for s in self.submissions if s["id"] == parts[1])
            return 200, {"data": [{"id": f"I-{vid}", "type": "reviewSubmissionItems", "relationships": {
                "appStoreVersion": {"data": {"type": "appStoreVersions", "id": vid}}}} for vid in s["items"]]}
        if method == "POST" and path == "/reviewSubmissionItems":
            rel = body["data"]["relationships"]
            s = next(s for s in self.submissions if s["id"] == rel["reviewSubmission"]["data"]["id"])
            s["items"].append(rel["appStoreVersion"]["data"]["id"])
            return 201, {"data": {"id": self.new_id("I")}}
        if method == "PATCH" and parts[0] == "reviewSubmissions":
            s = next(s for s in self.submissions if s["id"] == parts[1])
            assert body["data"]["attributes"] == {"submitted": True}
            s["state"] = "WAITING_FOR_REVIEW"
            return 200, {"data": {"id": s["id"], "type": "reviewSubmissions", "attributes": {"state": "WAITING_FOR_REVIEW"}}}
        return 404, {"errors": [{"code": "NOT_FOUND", "title": f"unrouted {method} {path}"}]}

    def writes(self):
        return [(m, p) for (m, p, _, _) in self.calls if m != "GET"]


def build(bid, number, state, marketing="8.1.41", **extra):
    attrs = {"version": number, "processingState": state, "expired": False, "usesNonExemptEncryption": False,
             "_marketing": marketing}
    attrs.update(extra)
    return {"id": bid, "type": "builds", "attributes": attrs}


def version(vid, string, state, **extra):
    attrs = {"versionString": string, "appVersionState": state, "platform": "IOS", "createdDate": "2026-10-01T00:00:00Z"}
    attrs.update(extra)
    return {"id": vid, "type": "appStoreVersions", "attributes": attrs}


def loc(lid, locale, whats_new=None):
    return {"id": lid, "type": "appStoreVersionLocalizations", "attributes": {"locale": locale, "whatsNew": whats_new}}


def run(fake, dry_run=False, **kwargs):
    sleeps = []
    client = mod.AscClient(lambda: "test-token", dry_run=dry_run, urlopen=fake, sleep=sleeps.append)
    args = dict(bundle="com.touliao.app", version="8.1.41", whats_new=WHATS_NEW,
                review_detail={"contactEmail": "a@b.c", "demoAccountName": "x", "demoAccountPassword": "secret"},
                wait_max=600, interval=30)
    args.update(kwargs)
    return mod.submit(client, **args), sleeps


LIVE_8140 = version("V40", "8.1.40", "READY_FOR_DISTRIBUTION", releaseType="MANUAL", createdDate="2026-09-20T00:00:00Z")


class SubmitTests(unittest.TestCase):
    def test_existing_editable_version_gets_notes_build_and_new_submission(self):
        fake = FakeASC(versions=[LIVE_8140, version("V41", "8.1.41", "PREPARE_FOR_SUBMISSION")],
                       localizations={"V41": [loc("L-zh", "zh-Hans"), loc("L-en", "en-US")]})
        result, _ = run(fake, build_number="1760000000")
        self.assertEqual(result["status"], "submitted")
        self.assertEqual(fake.attached["V41"], "B41")
        texts = {l["attributes"]["locale"]: l["attributes"]["whatsNew"] for l in fake.localizations["V41"]}
        self.assertEqual(texts, {"zh-Hans": WHATS_NEW["zh-Hans"], "en-US": WHATS_NEW["default"]})
        self.assertNotIn(("POST", "/appStoreVersions"), fake.writes())
        self.assertEqual(fake.writes()[-3:], [("POST", "/reviewSubmissions"), ("POST", "/reviewSubmissionItems"),
                                              ("PATCH", "/reviewSubmissions/S1")])
        self.assertEqual(fake.submissions[0]["items"], ["V41"])

    def test_missing_version_is_created_with_previous_release_type(self):
        fake = FakeASC(versions=[LIVE_8140])
        result, _ = run(fake)
        self.assertEqual(result["status"], "submitted")
        post = next(c for c in fake.calls if c[:2] == ("POST", "/appStoreVersions"))
        attrs = post[3]["data"]["attributes"]
        self.assertEqual(attrs, {"platform": "IOS", "versionString": "8.1.41", "releaseType": "MANUAL"})
        self.assertEqual(post[3]["data"]["relationships"]["app"]["data"]["id"], APP)
        new_id = result["version"]
        self.assertEqual(fake.attached[new_id], "B41")
        self.assertTrue(all(l["attributes"]["whatsNew"] for l in fake.localizations[new_id]))

    def test_other_editable_version_is_renamed_not_duplicated(self):
        fake = FakeASC(versions=[LIVE_8140, version("V39", "8.1.39", "DEVELOPER_REJECTED")],
                       localizations={"V39": [loc("L-zh", "zh-Hans")]})
        result, _ = run(fake)
        self.assertEqual(result["version"], "V39")
        self.assertIn(("PATCH", "/appStoreVersions/V39"), fake.writes())
        self.assertNotIn(("POST", "/appStoreVersions"), fake.writes())
        self.assertEqual(fake.versions[1]["attributes"]["versionString"], "8.1.41")

    def test_already_submitted_is_idempotent_without_writes(self):
        fake = FakeASC(versions=[LIVE_8140, version("V41", "8.1.41", "WAITING_FOR_REVIEW")], attached={"V41": "B41"},
                       submissions=[{"id": "S9", "state": "WAITING_FOR_REVIEW", "items": ["V41"]}])
        result, _ = run(fake, build_number="1760000000")
        self.assertEqual(result["status"], "already_submitted")
        self.assertEqual(fake.writes(), [])

    def test_rerun_after_successful_submit_does_nothing(self):
        fake = FakeASC(versions=[LIVE_8140, version("V41", "8.1.41", "PREPARE_FOR_SUBMISSION")],
                       localizations={"V41": [loc("L-zh", "zh-Hans")]})
        run(fake)
        fake.versions[1]["attributes"]["appVersionState"] = "WAITING_FOR_REVIEW"
        before = len(fake.writes())
        result, _ = run(fake)
        self.assertEqual(result["status"], "already_submitted")
        self.assertEqual(len(fake.writes()), before)

    def test_in_review_with_different_build_is_an_error(self):
        fake = FakeASC(versions=[version("V41", "8.1.41", "IN_REVIEW")], attached={"V41": "B-old"})
        with self.assertRaises(mod.SubmitError):
            run(fake)
        self.assertEqual(fake.writes(), [])

    def test_other_version_in_review_blocks_creation(self):
        fake = FakeASC(versions=[version("V40", "8.1.40", "WAITING_FOR_REVIEW")])
        with self.assertRaises(mod.SubmitError):
            run(fake)
        self.assertEqual(fake.writes(), [])

    def test_open_draft_submission_is_reused_and_only_submitted(self):
        fake = FakeASC(versions=[version("V41", "8.1.41", "READY_FOR_REVIEW")], attached={"V41": "B41"},
                       localizations={"V41": [loc("L-zh", "zh-Hans", WHATS_NEW["zh-Hans"])]},
                       submissions=[{"id": "S5", "state": "READY_FOR_REVIEW", "items": ["V41"]}])
        result, _ = run(fake)
        self.assertEqual(result["status"], "submitted")
        self.assertEqual(fake.writes(), [("PATCH", "/reviewSubmissions/S5")])

    def test_rejected_submission_is_resubmitted(self):
        fake = FakeASC(versions=[version("V41", "8.1.41", "REJECTED")], attached={"V41": "B-old"},
                       localizations={"V41": [loc("L-zh", "zh-Hans")]},
                       submissions=[{"id": "S7", "state": "UNRESOLVED_ISSUES", "items": ["V41"]}])
        run(fake)
        self.assertEqual(fake.attached["V41"], "B41")
        self.assertNotIn(("POST", "/reviewSubmissions"), fake.writes())
        self.assertNotIn(("POST", "/reviewSubmissionItems"), fake.writes())
        self.assertEqual(fake.writes()[-1], ("PATCH", "/reviewSubmissions/S7"))

    def test_another_submission_in_review_is_an_error(self):
        fake = FakeASC(versions=[version("V41", "8.1.41", "PREPARE_FOR_SUBMISSION")],
                       localizations={"V41": [loc("L-zh", "zh-Hans")]},
                       submissions=[{"id": "S3", "state": "IN_REVIEW", "items": ["V-other"]}])
        with self.assertRaises(mod.SubmitError):
            run(fake)
        self.assertNotIn(("PATCH", "/reviewSubmissions/S3"), fake.writes())

    def test_dry_run_never_writes(self):
        for versions in ([LIVE_8140], [LIVE_8140, version("V41", "8.1.41", "PREPARE_FOR_SUBMISSION")]):
            fake = FakeASC(versions=versions, localizations={"V41": [loc("L-zh", "zh-Hans")]},
                           builds=[build("B41", "1760000000", "VALID", usesNonExemptEncryption=None)],
                           review_detail=False)
            result, _ = run(fake, dry_run=True)
            self.assertEqual(result["status"], "dry_run")
            self.assertEqual(fake.writes(), [], versions)

    def test_build_number_waits_until_valid(self):
        fake = FakeASC(versions=[version("V41", "8.1.41", "PREPARE_FOR_SUBMISSION")],
                       localizations={"V41": [loc("L-zh", "zh-Hans")]},
                       builds=[build("B41", "1760000000", "PROCESSING", _states=["PROCESSING", "PROCESSING", "VALID"])])
        result, sleeps = run(fake, build_number="1760000000")
        self.assertEqual(result["build"], "B41")
        self.assertEqual(sleeps, [30, 30])

    def test_latest_valid_build_skips_expired_and_processing(self):
        fake = FakeASC(versions=[version("V41", "8.1.41", "PREPARE_FOR_SUBMISSION")],
                       localizations={"V41": [loc("L-zh", "zh-Hans")]},
                       builds=[build("B-exp", "3", "VALID", expired=True), build("B-new", "2", "VALID"),
                               build("B-other", "9", "VALID", marketing="8.1.40")])
        result, _ = run(fake)
        self.assertEqual(result["build"], "B-new")

    def test_no_usable_build_fails_fast(self):
        fake = FakeASC(builds=[build("B-old", "1", "VALID", marketing="8.1.40")])
        with self.assertRaises(mod.SubmitError):
            run(fake)

    def test_encryption_answer_and_missing_review_detail_are_filled(self):
        fake = FakeASC(versions=[version("V41", "8.1.41", "PREPARE_FOR_SUBMISSION")],
                       localizations={"V41": [loc("L-zh", "zh-Hans")]},
                       builds=[build("B41", "1760000000", "VALID", usesNonExemptEncryption=None)], review_detail=False)
        run(fake)
        enc = next(c for c in fake.calls if c[:2] == ("PATCH", "/builds/B41"))
        self.assertEqual(enc[3]["data"]["attributes"], {"usesNonExemptEncryption": False})
        rd = next(c for c in fake.calls if c[:2] == ("POST", "/appStoreReviewDetails"))
        self.assertEqual(rd[3]["data"]["relationships"]["appStoreVersion"]["data"]["id"], "V41")

    def test_transient_503_on_read_is_retried(self):
        fake = FakeASC(versions=[version("V41", "8.1.41", "PREPARE_FOR_SUBMISSION")],
                       localizations={"V41": [loc("L-zh", "zh-Hans")]}, fail_first_get="/apps/APP1/appStoreVersions")
        result, sleeps = run(fake)
        self.assertEqual(result["status"], "submitted")
        self.assertEqual(sleeps, [5])

    def test_cli_requires_notes_and_valid_version(self):
        fake = FakeASC()
        client = mod.AscClient(lambda: "test-token", urlopen=fake, sleep=lambda s: None)
        self.assertEqual(mod.main(["--version", "8.1", "--config", "/nonexistent.json"], client=client), 1)
        self.assertEqual(mod.main(["--version", "v8.1.41", "--config", os.path.join(HERE, "..", "ios", "testflight-config.json")], client=client), 1)
        self.assertEqual(fake.calls, [])

    def test_repo_config_has_whats_new_for_dry_run(self):
        fake = FakeASC(versions=[LIVE_8140])
        client = mod.AscClient(lambda: "test-token", dry_run=True, urlopen=fake, sleep=lambda s: None)
        code = mod.main(["--version", "8.1.41", "--dry-run", "--config", os.path.join(HERE, "..", "ios", "testflight-config.json")], client=client)
        self.assertEqual(code, 0)
        self.assertEqual(fake.writes(), [])

    def test_whats_new_locale_fallback(self):
        self.assertEqual(mod.pick_text({"zh-Hans": "中", "default": "d"}, "zh-Hant"), "中")
        self.assertEqual(mod.pick_text({"zh-Hans": "中", "default": "d"}, "ja"), "d")
        self.assertEqual(mod.pick_text("同一段", "en-US"), "同一段")

    def test_dry_run_log_redacts_passwords(self):
        self.assertEqual(mod.redact({"data": {"attributes": {"demoAccountPassword": "x", "a": 1}}}),
                         {"data": {"attributes": {"demoAccountPassword": "***", "a": 1}}})


if __name__ == "__main__":
    unittest.main(verbosity=2)
