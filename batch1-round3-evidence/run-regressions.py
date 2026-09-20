"""Run only batch-1 regressions, with isolated environment and retained raw output."""
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
evidence = Path(__file__).resolve().parent
env = {"PATH": os.environ["PATH"], "TMPDIR": str(evidence / "tmp"), "NO_COLOR": "1"}
jest = ["node", "--experimental-vm-modules", "node_modules/jest/bin/jest.js",
        "--runInBand", "--forceExit", "--verbose"]
jobs = [(name + "-standard", "backend-v2", jest + ["--runTestsByPath", f"test/{name}.test.js"])
        for name in ["message-sync", "forward-multi", "chat-files", "p1-02-uploads-idor",
                     "f02-file-socket.live", "f01-proxy-handshake.live"]]
jobs += [("backend-core", "backend-v2", jest + ["--runTestsByPath"] +
          [f"test/{name}.test.js" for name in ["f01-proxy-handshake", "f03-clear-role",
           "f02-file-forward-auth", "f06-financial-idempotency", "p0-schema-drift"]]),
         ("backend-inprocess", "backend-v2", jest +
          ["--setupFilesAfterEnv", str(evidence / "inprocess-supertest.cjs"), "--runTestsByPath"] +
          [f"test/{name}.test.js" for name in ["message-sync", "forward-multi", "chat-files", "p1-02-uploads-idor"]]),
         ("web-f06", "web", ["node", "node_modules/.bin/vitest", "run", "--configLoader", "native", "--no-cache",
          "src/utils/f06-axios-retry.test.js", "src/components/f06-financial-modals.test.jsx",
          "src/utils/axiosSessionRefresh.test.js", "src/utils/uploadFallback.test.js", "src/contexts/AuthSession.test.jsx"])]
results = []
for name, cwd, command in jobs:
    with (evidence / f"{name}.log").open("w") as output:
        result = subprocess.run(command, cwd=root / cwd, env=env, stdout=output, stderr=subprocess.STDOUT)
    results.append({"name": name, "cwd": str(root / cwd), "command": command, "exit_code": result.returncode})
    (evidence / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    print(f"{name}: exit={result.returncode}", flush=True)
