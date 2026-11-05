"""Verify Stage 9 Gen11 frozen content, index, snapshot and review record."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
BUNDLE = ROOT / "docs/evidence/phase-1-m1/stage-9/gen11"
REVIEWS = ROOT / "docs/reviews/phase-1-m1/stage-9"
FREEZE_SHA = "9d346074b76ac8f07cd61132dd6d0b6687bbce91ee2b99b0bc8dd8dfff64a3d9"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(path.read_text())


def verify_rows(rows):
    paths = [row["path"] for row in rows]
    assert len(paths) == len(set(paths)), "duplicate path"
    for row in rows:
        path = Path(row["path"])
        assert not path.is_absolute() and ".." not in path.parts
        target = ROOT / path
        assert target.is_file() and not target.is_symlink(), str(path)
        data = target.read_bytes()
        assert len(data) == row["bytes"] and sha(data) == row["sha256"], str(path)


def aggregate(rows):
    stream = "".join(row["path"] + "\0" + str(row["bytes"]) + "\0" + row["sha256"] + "\n"
                     for row in sorted(rows, key=lambda row: row["path"].encode()))
    return sha(stream.encode())


freeze_path = BUNDLE / "candidate-freeze.json"
assert sha(freeze_path.read_bytes()) == FREEZE_SHA
freeze = load(freeze_path)
assert freeze["declaredCount"] == len(freeze["entries"]) == 189
verify_rows(freeze["entries"])
assert aggregate(freeze["entries"]) == freeze["aggregateSha256"]
index = load(BUNDLE / "execution/EVIDENCE_INDEX.json")
assert index["artifactCount"] == len(index["artifacts"]) == 37
verify_rows(index["artifacts"])
assert aggregate(index["artifacts"]) == index["aggregateSha256"]
assert {row["path"] for row in index["artifacts"]} | {
    (BUNDLE / "execution/EVIDENCE_INDEX.json").relative_to(ROOT).as_posix()
} == {p.relative_to(ROOT).as_posix() for p in (BUNDLE / "execution").iterdir()}
snapshot_path = BUNDLE / "execution/source-snapshot.json"
assert sha(snapshot_path.read_bytes()) == freeze["sourceSnapshotSha256"]
snapshot = load(snapshot_path)
assert len(snapshot["files"]) == 692
verify_rows(snapshot["files"])
scan = load(BUNDLE / "final-candidate-scan.json")
assert scan["result"] == "PASS" and scan["findingCount"] == 0
assert scan["candidateFreezeSha256"] == FREEZE_SHA
assert scan["filesScanned"] == len(scan["files"]) == 190
verify_rows(scan["files"])
assert {row["path"] for row in scan["files"]} == {
    row["path"] for row in freeze["entries"]
} | {freeze_path.relative_to(ROOT).as_posix()}
review = (REVIEWS / "GEN11_FINAL_INDEPENDENT_REVIEW.md").read_text()
assert FREEZE_SHA in review and "GO for Stage 9 DEVELOPMENT closure only" in review
assert "sa-0-182594c1" in review and "deleg_bb1cfd0c" in review
assert "GO for Stage 9 DEVELOPMENT only" in (REVIEWS / "GEN11_ADJUDICATION.md").read_text()
assert freeze["stage10Actions"] == 0
print(json.dumps({"result": "PASS", "freezeEntries": 189, "evidenceArtifacts": 37,
                  "sourceFiles": 692, "scanFiles": 190, "freezeSha256": FREEZE_SHA,
                  "review": "GO_STAGE9_DEVELOPMENT_ONLY", "stage10Actions": 0}))
