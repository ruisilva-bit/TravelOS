"""Read-only supplemental verification; does not modify the frozen Gen11 bundle."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
EXECUTION = ROOT / "docs/evidence/phase-1-m1/stage-9/gen11/execution"


def load(path):
    return json.loads(path.read_text())


def verify_file(path, expected_bytes, expected_hash):
    content = path.read_bytes()
    assert len(content) == expected_bytes, str(path)
    assert hashlib.sha256(content).hexdigest() == expected_hash, str(path)


receipt = load(EXECUTION / "canonical-ci-receipt.json")
claim = load(EXECUTION / "canonical-ci-claim.json")
assert receipt["logSha256"] == claim["logSha256"]
verify_file(EXECUTION / "canonical-ci.log", receipt["logBytes"], receipt["logSha256"])

deployment = load(EXECUTION / "deployment.json")
count = 0
for command in deployment["commands"]:
    for entry in command.get("logs", {}).values():
        relative = Path(entry["path"])
        assert not relative.is_absolute() and ".." not in relative.parts
        target = ROOT / relative
        assert target.is_file() and not target.is_symlink(), str(relative)
        verify_file(target, entry["bytes"], entry["sha256"])
        count += 1
assert count > 0
print(json.dumps({"result": "PASS", "ciLogBytes": receipt["logBytes"],
                  "ciLogSha256": receipt["logSha256"],
                  "localDeploymentLogsVerified": count,
                  "limitation": "Deployment logs remain local external sidecars, not frozen bundle entries."}))
