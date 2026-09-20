"""Prove the supplemental transport still detects the original N-1 regression."""
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
evidence = Path(__file__).resolve().parent
service = root / "backend-v2/src/modules/messages/messages.service.js"
current = service.read_bytes()
new = b"const retryableIds = uniqueFailedIds.filter(id => !nonRetryableReasons.has(failureReasons.get(id)));"
old = "const retryableIds = uniqueFailedIds.filter(id => writeFailedSourceIds.has(id) && failureReasons.get(id) !== '没有可用的目标会话');".encode()
assert current.count(new) == 1
env = {"PATH": os.environ["PATH"], "TMPDIR": str(evidence / "tmp"), "NO_COLOR": "1"}
command = ["node", "--experimental-vm-modules", "node_modules/jest/bin/jest.js", "--runInBand", "--forceExit", "--verbose",
           "--setupFilesAfterEnv", str(evidence / "inprocess-supertest.cjs"), "--runTestsByPath", "test/message-sync.test.js"]
def run(name):
    with (evidence / f"{name}.log").open("w") as output:
        result = subprocess.run(command, cwd=root / "backend-v2", env=env, stdout=output, stderr=subprocess.STDOUT)
    print(f"{name}: exit={result.returncode}", flush=True)
    return result.returncode
try:
    service.write_bytes(current.replace(new, old))
    before = run("n1-negative")
finally:
    service.write_bytes(current)
after = run("message-sync-inprocess-final")
assert before == 1 and after == 0
assert "1 failed, 12 passed, 13 total" in (evidence / "n1-negative.log").read_text()
assert "13 passed, 13 total" in (evidence / "message-sync-inprocess-final.log").read_text()
assert service.read_bytes() == current
print("Negative control detected N-1; final source restored; original message-sync assertions pass.")
