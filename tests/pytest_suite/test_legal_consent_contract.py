"""Offline contract for the HTTP helper; no account, network or database access."""
import importlib.util
import re
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


class ConsentContractTest(unittest.TestCase):
    def test_login_sends_explicit_current_consent_and_keeps_csrf_warmup(self):
        calls = []
        response = types.SimpleNamespace(status_code=200, json=lambda: {"user": {"id": "synthetic"}})
        session = types.SimpleNamespace(cookies={}, headers={}, hooks={"response": []})
        session.post = lambda url, **kwargs: (calls.append((url, kwargs)), response)[1]
        session.get = lambda url, **kwargs: (calls.append((url, kwargs)), response)[1]
        fake_requests = types.SimpleNamespace(Session=lambda: session, Response=object)
        source = Path(__file__).parent / "helpers/api_client.py"
        spec = importlib.util.spec_from_file_location("isolated_api_client", source)
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"jwt": types.SimpleNamespace(), "requests": fake_requests}):
            # Compile directly to avoid writing __pycache__ into the repository.
            exec(compile(source.read_text(), str(source), "exec"), module.__dict__)
        client = module.VxinSession("http://synthetic.invalid")
        self.assertIs(client.login("13000000001", "synthetic-password"), client)
        policy = Path(__file__).resolve().parents[2] / "backend-v2/src/modules/legal/documents.js"
        version = re.search(r"const version = '([^']+)'", policy.read_text()).group(1)
        self.assertEqual(calls[0], ("http://synthetic.invalid/api/auth/login", {"json": {
            "phone": "13000000001", "password": "synthetic-password",
            "legalConsent": {"accepted": True, "privacyVersion": version, "termsVersion": version},
        }}))
        self.assertEqual(calls[1][0], "http://synthetic.invalid/api/auth/me")
        self.assertEqual(client.user, {"id": "synthetic"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
