"""Read-only verification of the accepted Stage 8 gen03 evidence and closure."""
import hashlib
import json
from pathlib import Path

ROOT = Path.cwd()
BUNDLE = Path("docs/evidence/phase-1-m1/stage-8/gen03")
REVIEWS = Path("docs/reviews/phase-1-m1/stage-8")
FREEZE_SHA = "644c3588dc3392469ec67f8628c84e6b782b1c465941c577c9242680b56582f9"
REVIEW_SHA = "0c14162631e1475da96dd78d4aba3c2ad29869fa20680029e252e26b3f79c7c5"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads((ROOT / path).read_text())


def verify_rows(rows):
    paths = [row["path"] for row in rows]
    assert len(paths) == len(set(paths)), "Duplicate manifest paths"
    for row in rows:
        relative = Path(row["path"])
        assert not relative.is_absolute() and ".." not in relative.parts
        target = ROOT / relative
        assert target.is_file() and not target.is_symlink(), str(relative)
        content = target.read_bytes()
        assert len(content) == row["bytes"], str(relative)
        assert sha(content) == row["sha256"], str(relative)


def aggregate(rows):
    ordered = sorted(rows, key=lambda row: row["path"].encode())
    stream = "".join(
        row["path"] + "\0" + str(row["bytes"]) + "\0" + row["sha256"] + "\n"
        for row in ordered
    )
    return sha(stream.encode())


freeze_path = BUNDLE / "candidate-freeze.json"
assert sha((ROOT / freeze_path).read_bytes()) == FREEZE_SHA
freeze = load(freeze_path)
assert freeze["declaredCount"] == len(freeze["entries"]) == 130
verify_rows(freeze["entries"])
assert aggregate(freeze["entries"]) == freeze["aggregateSha256"]

index = load(BUNDLE / "execution/EVIDENCE_INDEX.json")
assert index["artifactCount"] == len(index["artifacts"]) == 73
verify_rows(index["artifacts"])
assert aggregate(index["artifacts"]) == index["aggregateSha256"]
assert {row["path"] for row in index["artifacts"]} | {
    (BUNDLE / "execution/EVIDENCE_INDEX.json").as_posix()
} == {p.relative_to(ROOT).as_posix() for p in (ROOT / BUNDLE / "execution").iterdir()}

snapshot_path = BUNDLE / "execution/source-snapshot.json"
assert sha((ROOT / snapshot_path).read_bytes()) == freeze["sourceSnapshotSha256"]
snapshot = load(snapshot_path)
assert len(snapshot["files"]) == 600
verify_rows(snapshot["files"])

scan = load(BUNDLE / "final-candidate-scan.json")
assert scan["result"] == "PASS" and scan["findingCount"] == 0
assert scan["candidateFreezeSha256"] == FREEZE_SHA
assert scan["filesScanned"] == len(scan["files"]) == 131
verify_rows(scan["files"])
assert {row["path"] for row in scan["files"]} == {
    row["path"] for row in freeze["entries"]
} | {freeze_path.as_posix()}

review_path = REVIEWS / "GEN03_INDEPENDENT_REVIEW.json"
assert sha((ROOT / review_path).read_bytes()) == REVIEW_SHA
review = load(review_path)
assert review["recommendation"] == "GO" and review["reviewedFreezeSha256"] == FREEZE_SHA
assert review["findings"] == []
assert {finding["id"]: finding["status"] for finding in review["priorFindings"]} == {
    "S8-OBS-001": "CLOSED", "S8-OBS-002": "CLOSED"
}
adjudication = load(REVIEWS / "GEN03_ADJUDICATION.json")
assert adjudication["decision"] == "GO" and adjudication["openFindings"] == []
assert adjudication["independentReviewer"]["reportSha256"] == REVIEW_SHA
assert adjudication["stage9Actions"] == 0

closure_scan = load(REVIEWS / "GEN03_CLOSURE_SCAN.json")
assert closure_scan["result"] == "PASS" and closure_scan["findingCount"] == 0
verify_rows(closure_scan["files"])
assert (REVIEWS / "GEN03_CLOSURE.md").as_posix() in {
    row["path"] for row in closure_scan["files"]
}
print(json.dumps({
    "result": "PASS", "freezeEntries": 130, "evidenceArtifacts": 73,
    "sourceFiles": 600, "freezeSha256": FREEZE_SHA,
    "independentReview": "GO", "openFindings": 0,
    "closureScanFiles": closure_scan["filesScanned"], "stage9Actions": 0
}))
