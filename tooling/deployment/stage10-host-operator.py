"""Protected host dispatcher. Install only with separately authorized host provisioning.

No installer and no claim of independent pin provenance. Fixed native entry invokes
this with Python -I and a clean environment. Never permit sudo python/script directly.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

BASE = Path("/usr/local/lib/travelos-stage10")
TRUST = Path("/etc/travelos")
ROOT = Path("/opt/travelos")
INCOMING = Path("/var/lib/travelos-stage10/incoming")
ENTRY = Path("/usr/local/sbin/travelos-stage10-operator")
SCRIPT = Path("/usr/local/libexec/travelos-stage10/operator.py")
DOCUMENTS = (
    "stage10-development-policy.json",
    "stage10-activation-authorization.json",
    "stage10-qualification-receipt.json",
)
CHECKS = {"canonicalCi", "deploymentContract", "exactArtifactRehearsal", "migrationCompatibility", "restorePoint"}


def require(condition):
    if not condition:
        raise ValueError("STAGE10_HOST_REJECTED")


def protected(file, directory=False):
    require(file.is_absolute() and str(file) == os.path.normpath(file))
    for parent in reversed(file.parents):
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o022)
        require(info.st_uid == 0)
    info = file.lstat()
    require(info.st_uid == 0 and not info.st_mode & 0o7022)
    require(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1)
    return info


def read(file, maximum):
    protected(file)
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1)
        require(not info.st_mode & 0o7022 and info.st_size <= maximum)
        with os.fdopen(fd, "rb", closefd=False) as source:
            data = source.read(maximum + 1)
        require(len(data) <= maximum)
        return data
    finally:
        os.close(fd)


def digest(file, maximum=1073741824):
    protected(file)
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1)
        require(not info.st_mode & 0o7022 and info.st_size <= maximum)
        with os.fdopen(fd, "rb", closefd=False) as source:
            result = hashlib.sha256()
            total = 0
            while chunk := source.read(1048576):
                total += len(chunk)
                require(total <= maximum)
                result.update(chunk)
            return result.hexdigest()
    finally:
        os.close(fd)


def pairs(values):
    result = {}
    for name, value in values:
        require(name not in result)
        result[name] = value
    return result


def document(file):
    value = json.loads(read(file, 16384), object_pairs_hook=pairs)
    require(isinstance(value, dict))
    return value


def keys(value, expected):
    require(isinstance(value, dict) and set(value) == set(expected))


def hash_value(value):
    require(isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value))


def validate():
    require(os.getuid() == 0 and os.geteuid() == 0)
    for directory in (BASE, TRUST, ROOT / "releases", ROOT / ".stage10-private", INCOMING):
        protected(directory, directory=True)
    require(stat.S_IMODE((ROOT / ".stage10-private").stat().st_mode) == 0o700)
    require(stat.S_IMODE(INCOMING.stat().st_mode) == 0o700)
    host = document(TRUST / "stage10-host-policy.json")
    keys(host, ("schemaVersion", "environment", "files", "trustDocuments"))
    require(type(host["schemaVersion"]) is int and host["schemaVersion"] == 1 and host["environment"] == "DEVELOPMENT")
    expected = {str(p) for p in (ENTRY, SCRIPT, BASE / "node", BASE / "cosign", BASE / "stage10-activation.mjs", BASE / "stage10-signature.mjs", Path("/usr/bin/python3").resolve(strict=True))}
    keys(host["files"], expected)
    keys(host["trustDocuments"], DOCUMENTS)
    for file, pin in host["files"].items():
        hash_value(pin)
        require(digest(Path(file), 268435456) == pin)
    # Enforce static ELF, not just a suggested build flag. A PT_INTERP segment
    # would process LD_* before main; the entry must have no program interpreter.
    entry = read(ENTRY, 16777216)
    require(entry[:6] == b"\x7fELF\x02\x01")  # supported target: Linux ELF64 little endian
    import struct
    offset = struct.unpack_from("<Q", entry, 32)[0]
    stride, count = struct.unpack_from("<HH", entry, 54)
    require(stride >= 4 and count > 0 and offset + stride * count <= len(entry))
    require(all(struct.unpack_from("<I", entry, offset + i * stride)[0] != 3 for i in range(count)))
    for name, pin in host["trustDocuments"].items():
        hash_value(pin)
        require(digest(TRUST / name, 8192) == pin)
    policy, authorization, receipt = (document(TRUST / name) for name in DOCUMENTS)
    keys(policy, ("environment", "artifactSha256", "publicKeySha256", "cosignSha256"))
    require(policy["environment"] == "DEVELOPMENT")
    for field in ("artifactSha256", "publicKeySha256", "cosignSha256"):
        hash_value(policy[field])
    keys(authorization, ("schemaVersion", "environment", "artifactId", "artifactSha256", "expectedCurrentTarget", "qualificationReceiptSha256"))
    keys(receipt, ("schemaVersion", "environment", "artifactId", "artifactSha256", "publicKeySha256", "bundleSha256", "expectedCurrentTarget", "migrationHead", "offlineTransparencyAccepted", "checks"))
    for name in ("schemaVersion", "environment", "artifactId", "artifactSha256", "expectedCurrentTarget"):
        require(authorization[name] == receipt[name])
    require(type(authorization["schemaVersion"]) is int and authorization["schemaVersion"] == 1)
    require(type(receipt["schemaVersion"]) is int and receipt["schemaVersion"] == 1)
    require(authorization["environment"] == "DEVELOPMENT")
    import re
    require(isinstance(receipt["artifactId"], str) and re.fullmatch(r"travelos-stage(?:9|10)-[a-z0-9][a-z0-9-]{0,80}", receipt["artifactId"]))
    require(isinstance(receipt["migrationHead"], str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", receipt["migrationHead"]))
    require(receipt["offlineTransparencyAccepted"] is True)
    keys(receipt["checks"], CHECKS)
    require(all(value == "PASS" for value in receipt["checks"].values()))
    require(authorization["qualificationReceiptSha256"] == digest(TRUST / DOCUMENTS[2], 8192))
    for name in ("artifactSha256", "publicKeySha256"):
        require(receipt[name] == policy[name])
    require(policy["cosignSha256"] == host["files"][str(BASE / "cosign")])
    baseline = Path(authorization["expectedCurrentTarget"])
    require(baseline.parent == ROOT / "releases" and str(baseline) == authorization["expectedCurrentTarget"])
    protected(baseline, directory=True)
    current = ROOT / "current"
    info = current.lstat()
    require(stat.S_ISLNK(info.st_mode) and info.st_uid == 0)
    require(os.readlink(current) == str(baseline) and current.resolve(strict=True) == baseline)
    archive = INCOMING / (policy["artifactSha256"] + ".tar.gz")
    bundle = INCOMING / (policy["artifactSha256"] + ".sigstore.json")
    key = TRUST / "stage10-development.pub"
    require(digest(archive) == policy["artifactSha256"])
    require(digest(bundle, 4194304) == receipt["bundleSha256"])
    require(digest(key, 65536) == policy["publicKeySha256"])
    return archive, bundle, key


def main():
    require(len(sys.argv) == 2 and sys.argv[1] in ("validate", "activate"))
    archive, bundle, key = validate()
    if sys.argv[1] == "validate":
        print(json.dumps({"result":"HOST_PROVISION_STRUCTURE_VALIDATED", "signatureVerification":"NOT_PERFORMED", "independentPinProvenance":"REQUIRES_EXTERNAL_REVIEW", "sudoBypassRemoval":"NOT_ASSESSED", "runtimeAcceptance":"NOT_PERFORMED"}, sort_keys=True))
        return 0
    # No candidate interpreter, generic command, import override or arbitrary argv.
    result = subprocess.run([str(BASE / "node"), "--no-addons", str(BASE / "stage10-activation.mjs"), str(archive), str(bundle), str(key), str(BASE / "cosign")], env={"PATH":"/usr/bin:/bin","HOME":"/nonexistent","LANG":"C.UTF-8"}, cwd="/", stdin=subprocess.DEVNULL, close_fds=True, check=False)
    return 0 if result.returncode == 0 else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        print('{"result":"FAIL","code":"STAGE10_HOST_REJECTED"}', file=sys.stderr)
        raise SystemExit(1)
