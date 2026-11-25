"""Always construct disposable mounts; never write host /etc, /opt or /usr/local."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
CHILD = r'''
import ctypes, hashlib, io, json, os, pathlib, shutil, subprocess, sys, tarfile, tempfile
here, native, node, cosign = map(pathlib.Path, sys.argv[1:])
os.umask(0o022)
# Construct root-owned /usr and /var ancestors too: host root is unmapped in
# this user namespace. No production ownership checks are relaxed for tests.
libc = ctypes.CDLL(None, use_errno=True)
saved_usr = native.parent / "host-usr"
saved_usr.mkdir(mode=0o700)
subprocess.run(["/usr/bin/mount", "--bind", "/usr", str(saved_usr)], check=True)
host_python_fd=os.open((saved_usr/"bin/python3").resolve(),os.O_RDONLY)
for mount in ("/etc", "/opt", "/var"):
    subprocess.run(["/usr/bin/mount", "-t", "tmpfs", "-o", "mode=0755,nodev,nosuid", "tmpfs", mount], check=True)
def mount_raw(source, target, kind=None, flags=0, options=None):
    encode=lambda value: str(value).encode() if value is not None else None
    if libc.mount(encode(source),encode(target),encode(kind),flags,encode(options)):
        raise OSError(ctypes.get_errno(), "private mount failed: "+str(target))
mount_raw("tmpfs", "/usr", "tmpfs", 6, "mode=0755")
for library in ("lib", "lib64"):
    os.mkdir("/usr/"+library,0o755)
    mount_raw(saved_usr/library, "/usr/"+library, flags=4096)
os.mkdir("/usr/bin",0o755)
python_name=pathlib.Path(sys.executable).resolve().name
# Resolve against the preserved tree: /usr/bin is now intentionally empty.
python_name=(saved_usr/"bin/python3").resolve().name
for name in (python_name,"chmod"):
    shutil.copyfile(saved_usr/"bin"/name,pathlib.Path("/usr/bin")/name)
    (pathlib.Path("/usr/bin")/name).chmod(0o555)
pathlib.Path("/usr/bin/python3").symlink_to(python_name)
os.mkdir("/usr/local",0o755)
os.mkdir("/var/lib",0o755)
# A fresh chroot also makes '/' genuinely namespace-root-owned, so production
# validates EVERY ancestor (including '/') without a test-only exception.
private_root=native.parent/"private-root"; private_root.mkdir(mode=0o755)
mount_raw("tmpfs",private_root,"tmpfs",6,"mode=0755")
for name in ("usr","etc","opt","var","home","proc","dev"):
    (private_root/name).mkdir(mode=0o755)
    mount_raw("/"+name,private_root/name,flags=4096|(0 if name=="home" else 16384))
for name,target in (("lib","usr/lib"),("lib64","usr/lib64"),("bin","usr/bin")):
    (private_root/name).symlink_to(target)
os.chroot(private_root); os.chdir("/")
base = pathlib.Path("/usr/local/lib/travelos-stage10")
base.mkdir(parents=True)
pathlib.Path("/usr/local/libexec/travelos-stage10").mkdir(parents=True)
pathlib.Path("/usr/local/sbin").mkdir()
trust = pathlib.Path("/etc/travelos"); trust.mkdir(mode=0o700)
incoming = pathlib.Path("/var/lib/travelos-stage10/incoming"); incoming.mkdir(parents=True, mode=0o700)
root = pathlib.Path("/opt/travelos"); (root / "releases/baseline").mkdir(parents=True)
(root / ".stage10-private").mkdir(mode=0o700)
(root / "current").symlink_to(root / "releases/baseline")
operator = pathlib.Path("/usr/local/sbin/travelos-stage10-operator")
shutil.copyfile(native, operator); operator.chmod(0o555)
script = pathlib.Path("/usr/local/libexec/travelos-stage10/operator.py")
assert (here / "stage10-host-operator.py").is_file(), "protected host validator must exist"
shutil.copyfile(here / "stage10-host-operator.py", script); script.chmod(0o444)
for name, source in [("node", node), ("cosign", cosign), ("stage10-activation.mjs", here / "stage10-activation.mjs"), ("stage10-signature.mjs", here / "stage10-signature.mjs")]:
    shutil.copyfile(source, base / name); (base / name).chmod(0o555 if name in ("node", "cosign") else 0o444)
def digest(p): return hashlib.file_digest(open(p, "rb"), "sha256").hexdigest()
def document(name, value):
    p = trust / name; p.write_text(json.dumps(value, sort_keys=True) + "\n"); p.chmod(0o600); return p
with tempfile.TemporaryDirectory(prefix="travelos-stage10-host-", dir=os.environ["TMPDIR"]) as temporary:
    temporary = pathlib.Path(temporary); temporary.chmod(0o700)
    environment = {"PATH":"/usr/bin:/bin", "HOME":str(temporary), "COSIGN_PASSWORD":"synthetic-disposable-only"}
    def signrun(*args):
        return subprocess.run([str(cosign), *map(str,args)], cwd=temporary, env=environment, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    signrun("generate-key-pair", "--output-key-prefix", "fixture")
    signrun("signing-config", "create", "--out", "offline.json")
    source = temporary / "release.tar.gz"
    artifact_id = os.environ.get("TRAVELOS_REHEARSAL_ARTIFACT_ID", "travelos-stage10-operator-fixture")
    if os.environ.get("TRAVELOS_REHEARSAL_ARCHIVE"):
        source = pathlib.Path(os.environ["TRAVELOS_REHEARSAL_ARCHIVE"])
        assert digest(source) == os.environ["TRAVELOS_REHEARSAL_SHA256"], "independent exact archive pin mismatch"
    else:
        with tarfile.open(source,"w:gz") as archive:
            for name, payload in [("release.json", json.dumps({"artifactId":artifact_id}).encode()), ("payload.txt", b"verified payload\n")]:
                member=tarfile.TarInfo(name); member.size=len(payload); member.mode=0o644; archive.addfile(member,io.BytesIO(payload))
    archive_hash = digest(source)
    archive = incoming / (archive_hash + ".tar.gz"); shutil.copyfile(source,archive); archive.chmod(0o400)
    bundle = incoming / (archive_hash + ".sigstore.json")
    signrun("sign-blob", "--key", "fixture.key", "--signing-config", "offline.json", "--bundle", bundle, archive)
    bundle.chmod(0o400)
    key = trust / "stage10-development.pub"; shutil.copyfile(temporary / "fixture.pub",key); key.chmod(0o400)
    policy = {"environment":"DEVELOPMENT", "artifactSha256":archive_hash, "publicKeySha256":digest(key), "cosignSha256":digest(base / "cosign")}
    policy_file = document("stage10-development-policy.json",policy)
    receipt = {"schemaVersion":1,"environment":"DEVELOPMENT","artifactId":artifact_id,"artifactSha256":archive_hash,"publicKeySha256":digest(key),"bundleSha256":digest(bundle),"expectedCurrentTarget":str(root / "releases/baseline"),"migrationHead":"synthetic-not-qualified","offlineTransparencyAccepted":True,"checks":{name:"PASS" for name in ["canonicalCi","deploymentContract","exactArtifactRehearsal","migrationCompatibility","restorePoint"]}}
    receipt_file = document("stage10-qualification-receipt.json",receipt)
    authorization = {k:receipt[k] for k in ["schemaVersion","environment","artifactId","artifactSha256","expectedCurrentTarget"]}
    authorization["qualificationReceiptSha256"] = digest(receipt_file)
    auth_file = document("stage10-activation-authorization.json", authorization)
    pinned = [operator,script,base/"node",base/"cosign",base/"stage10-activation.mjs",base/"stage10-signature.mjs",pathlib.Path("/usr/bin/python3").resolve()]
    host = {"schemaVersion":1,"environment":"DEVELOPMENT","files":{str(p):digest(p) for p in pinned},"trustDocuments":{p.name:digest(p) for p in [policy_file,receipt_file,auth_file]}}
    host_file = document("stage10-host-policy.json",host)
    # A static launcher ignores loader/interpreter injection before Python starts.
    poison = temporary / "poison.cjs"; poison.write_text("require('fs').writeFileSync('/opt/travelos/INJECTED','bad')")
    badenv = dict(os.environ, NODE_OPTIONS="--require="+str(poison), NODE_PATH=str(temporary), PYTHONPATH=str(temporary), PYTHONSTARTUP=str(poison), LD_PRELOAD=str(poison), LD_LIBRARY_PATH=str(temporary), PATH=str(temporary), HOME=str(temporary))
    def call(*args): return subprocess.run([str(operator),*args],env=badenv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=180)
    rejected = 0
    def reject(*args):
        global rejected
        watch=libc.inotify_init1(os.O_NONBLOCK|os.O_CLOEXEC)
        assert watch >= 0
        assert libc.inotify_add_watch(watch,str(root/"releases").encode(),0x100|0x80) >= 0
        control=root/"releases/.inotify-positive-control"
        control.write_text("synthetic-watch-control")
        assert os.read(watch,65536), "inotify observer must detect a real directory write"
        control.unlink()
        result=call(*args)
        try:
            events=os.read(watch,65536)
        except BlockingIOError:
            events=b""
        finally:
            os.close(watch)
        assert not events, "rejected operator input must never create/move an extraction target"
        assert result.returncode == 1, (args,result.returncode,result.stdout,result.stderr)
        rejected += 1
        assert result.stderr.strip() in ('{"result":"FAIL","code":"STAGE10_HOST_REJECTED"}', '{"result":"FAIL","code":"STAGE10_ACTIVATION_REJECTED"}'), result.stderr
        assert os.readlink(root / "current") == str(root / "releases/baseline")
        assert not (root / "INJECTED").exists()
        assert not list((root / "releases").glob("sha256-*")), "rejection must precede/purge extraction"
    result = call("validate")
    if result.returncode:
        diagnostic = subprocess.run(["/usr/bin/python3", "-I", "-c", "import runpy; runpy.run_path('/usr/local/libexec/travelos-stage10/operator.py')['validate']()"], env={"PATH":"/usr/bin:/bin","HOME":"/nonexistent"}, capture_output=True,text=True)
        print("private fixture diagnostic:",diagnostic.returncode,diagnostic.stderr,flush=True)
        print([(str(p),oct(p.lstat().st_mode),p.lstat().st_uid) for d in [base,trust,root/"releases",incoming] for p in [d,*d.parents]],flush=True)
    assert result.returncode == 0, (result.stdout,result.stderr)
    assert json.loads(result.stdout)["result"] == "HOST_PROVISION_STRUCTURE_VALIDATED"
    assert result.stderr == "", "static entry must ignore poisoned LD_* before interpreter startup"
    # Root-installed probe exercises the native launch boundary itself, not a mock.
    original_script=script.read_bytes()
    script.chmod(0o600)
    script.write_text("import os,sys,resource,json\nassert sys.flags.isolated == 1\nassert os.getcwd() == '/'\nassert set(os.environ) <= {'PATH','HOME','LANG','LC_CTYPE'}\nassert resource.getrlimit(resource.RLIMIT_CORE) == (0,0)\nfd=int(sys.argv[1]) if sys.argv[1].isdigit() else 234\ntry:\n os.fstat(fd)\nexcept OSError:\n print('NATIVE_BOUNDARY_PASS')\nelse:\n raise RuntimeError('inherited fd')\n")
    fd=os.open(poison,os.O_RDONLY)
    # Fixed supported action remains argv[1]; the actual inherited fd is cloned
    # to a known high number so the probe can inspect it without extra CLI args.
    os.dup2(fd,234); os.close(fd)
    probe=subprocess.run([str(operator),"validate"],env=badenv,pass_fds=(234,),capture_output=True,text=True)
    os.close(234)
    assert probe.returncode == 0 and probe.stdout.strip() == "NATIVE_BOUNDARY_PASS",(probe.stdout,probe.stderr)
    script.write_bytes(original_script); script.chmod(0o444)
    # Same pinned bytes, genuinely wrong kernel owner (host root is unmapped).
    python_path=pathlib.Path("/usr/bin/python3").resolve()
    mount_raw("/proc/self/fd/"+str(host_python_fd),python_path,flags=4096)
    assert python_path.stat().st_uid != 0 and digest(python_path) == host["files"][str(python_path)]
    reject("activate")
    assert libc.umount2(str(python_path).encode(),0) == 0
    os.close(host_python_fd)
    for directory in (base,base.parent,trust,root,root/"releases",incoming.parent):
        mode=directory.stat().st_mode & 0o777; directory.chmod(mode|0o020); reject("activate"); directory.chmod(mode)
    for member in (script,base/"node",trust/"stage10-host-policy.json"):
        saved=member.with_name(member.name+".saved"); member.rename(saved); member.symlink_to(saved)
        reject("activate"); member.unlink(); saved.rename(member)
    for args in [(),("activate","extra"),("shell",),("migrate",),("restart",),("/bin/sh",),("--policy=/tmp/fake",)]: reject(*args)
    for p in [script,base/"node",host_file,policy_file,receipt_file,auth_file,key,archive,bundle]:
        mode=p.stat().st_mode & 0o777; p.chmod(mode|0o020); reject("activate"); p.chmod(mode)
    original=host_file.read_bytes()
    broken=dict(host, unknown="forbidden"); document(host_file.name,broken); reject("activate"); host_file.write_bytes(original)
    original=script.read_bytes(); script.chmod(0o600); script.write_bytes(original+b"\n# drift\n"); reject("activate"); script.write_bytes(original); script.chmod(0o444)
    original=key.read_bytes(); key.chmod(0o600); key.write_bytes(b"wrong key"); reject("activate"); key.write_bytes(original); key.chmod(0o400)
    original=bundle.read_bytes(); bundle.chmod(0o600); bundle.write_bytes(b"unsigned"); reject("activate"); bundle.write_bytes(original); bundle.chmod(0o400)
    saved=archive.with_suffix(".saved"); archive.rename(saved); archive.symlink_to(saved); reject("activate"); archive.unlink(); saved.rename(archive)
    # Even independently provisioned hash changes cannot turn tampering into a signature.
    altered=incoming/"altered.tar.gz"; shutil.copyfile(archive,altered)
    with altered.open("ab") as output: output.write(b"tamper")
    altered_hash=digest(altered); renamed=incoming/(altered_hash+".tar.gz"); altered.rename(renamed)
    altered_bundle=incoming/(altered_hash+".sigstore.json"); shutil.copyfile(bundle,altered_bundle)
    def refresh_documents():
        document(policy_file.name,policy); document(receipt_file.name,receipt)
        authorization["qualificationReceiptSha256"]=digest(receipt_file); document(auth_file.name,authorization)
        host["trustDocuments"]={p.name:digest(p) for p in [policy_file,receipt_file,auth_file]}; document(host_file.name,host)
    for value in (policy,receipt,authorization): value["artifactSha256"]=altered_hash
    refresh_documents(); reject("activate")
    for value in (policy,receipt,authorization): value["artifactSha256"]=archive_hash
    refresh_documents(); renamed.unlink(); altered_bundle.unlink()
    # Python's bool is an int subclass: JSON schemaVersion must still be integer.
    receipt["schemaVersion"]=True; refresh_documents(); reject("validate")
    receipt["schemaVersion"]=1; refresh_documents()
    # Host policy can pin an invalid signature: actual Cosign must still reject it.
    original=bundle.read_bytes(); bundle.chmod(0o600); bundle.write_bytes(b"{}")
    receipt["bundleSha256"]=digest(bundle); document(receipt_file.name,receipt)
    authorization["qualificationReceiptSha256"]=digest(receipt_file); document(auth_file.name,authorization)
    host["trustDocuments"]={p.name:digest(p) for p in [policy_file,receipt_file,auth_file]}; document(host_file.name,host)
    reject("activate")
    bundle.write_bytes(original); bundle.chmod(0o400); receipt["bundleSha256"]=digest(bundle); document(receipt_file.name,receipt)
    authorization["qualificationReceiptSha256"]=digest(receipt_file); document(auth_file.name,authorization)
    host["trustDocuments"]={p.name:digest(p) for p in [policy_file,receipt_file,auth_file]}; document(host_file.name,host)
    result=call("activate"); assert result.returncode == 0,(result.stdout,result.stderr)
    activated=json.loads(result.stdout); assert activated["artifactSha256"] == archive_hash
    target=root / "releases" / ("sha256-"+archive_hash)
    assert os.readlink(root / "current") == str(target)
    assert json.loads((target / "release.json").read_text())["artifactId"] == artifact_id
    assert not (root / "INJECTED").exists()
    # Compare every signed regular member's bytes to the exact extracted tree.
    compared=0
    with tarfile.open(archive,"r:gz") as content:
        for member in content:
            if member.isfile():
                assert hashlib.sha256(content.extractfile(member).read()).hexdigest() == digest(target/member.name)
                compared+=1
    contract_result="SYNTHETIC_FIXTURE_NOT_A_RELEASE"
    if os.environ.get("TRAVELOS_REHEARSAL_ARCHIVE"):
        # Trusted version-controlled verifier reads candidate JSON/files only;
        # never execute artifact-owned code or its runtime as privileged root.
        if artifact_id.startswith("travelos-stage10-"):
            # Full package/runtime probes already ran as the non-root parent.
            # This namespace checks signed bytes, not artifact-owned programs.
            contract_result=json.loads(os.environ["TRAVELOS_PARENT_PACKAGE_QUALIFICATION"])
            assert contract_result["result"] == "PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED"
            assert contract_result["executionIdentity"] == "UNPRIVILEGED_PARENT"
            assert contract_result["artifactId"] == artifact_id
            assert contract_result["archiveSha256"] == archive_hash
        else:
            checked=subprocess.run([str(base/"node"),str(here.parent/"ci/stage-9/artifact-integrity.mjs"),"--artifact-root="+str(target)],env={"PATH":"/usr/bin:/bin","HOME":"/nonexistent"},capture_output=True,text=True,check=True)
            contract_result=json.loads(checked.stdout)
            assert contract_result["result"] == "PASS"
    assert call("activate").returncode == 1, "no reuse or replay"
    print(json.dumps({"result":"PASS","extractedContractVerification":contract_result,"archiveSha256":archive_hash,"artifactId":artifact_id,"regularMembersCompared":compared,"rejectedCases":rejected,"replayRejected":True,"nativeEnvironmentAndFdProbe":"PASS","syntheticSigningOnly":True,"runtimeAcceptance":"NOT_PERFORMED","hostInstallation":"NOT_PERFORMED"},sort_keys=True))
'''


def run():
    if sys.argv[1:]:
        raise SystemExit("USAGE: python3 test-stage10-host-operator.py")
    node = os.environ.get("TRAVELOS_NODE", "/usr/bin/node")
    cosign = os.environ["TRAVELOS_COSIGN"]
    qualification = None
    if os.environ.get("TRAVELOS_REHEARSAL_ARCHIVE") and os.environ.get("TRAVELOS_REHEARSAL_ARTIFACT_ID", "").startswith("travelos-stage10-"):
        # No namespace/root writes or compilation before independent input and
        # package checks pass. Never accept a caller-supplied PASS envelope.
        assert os.getuid() != 0 and os.geteuid() != 0
        assert Path(node).is_absolute()
        assert hashlib.file_digest(open(node, "rb"), "sha256").hexdigest() == os.environ["TRAVELOS_REHEARSAL_NODE_SHA256"]
        bindings = {
            "payload": "PAYLOAD", "archive": "ARCHIVE", "archive-sha256": "SHA256",
            "artifact-id": "ARTIFACT_ID", "receipt": "RECEIPT", "receipt-sha256": "RECEIPT_SHA256",
            "inputs": "INPUTS", "inputs-sha256": "INPUTS_SHA256", "node-sha256": "NODE_SHA256",
        }
        command = [node, str(HERE / "qualify-stage10-host-rehearsal.mjs")]
        command.extend("--" + key + "=" + os.environ["TRAVELOS_REHEARSAL_" + name] for key, name in bindings.items())
        checked = subprocess.run(command, env={"PATH":"/usr/bin:/bin","HOME":"/nonexistent"}, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=180, check=True)
        qualification = json.loads(checked.stdout)
        assert qualification["executionIdentity"] == "UNPRIVILEGED_PARENT"
    with __import__("tempfile").TemporaryDirectory(dir=os.environ["TMPDIR"], prefix="travelos-operator-build-") as directory:
        native = Path(directory) / "operator"
        source = HERE / "stage10-host-entry.c"
        assert source.is_file(), "fixed native entry point must exist"
        subprocess.run(["/usr/bin/cc", "-std=c17", "-O2", "-Wall", "-Wextra", "-Werror", "-static", "-o", str(native), str(source)], check=True)
        # The child cannot select a mode that skips namespace construction.
        environment = {k:v for k,v in os.environ.items() if not k.startswith(("PYTHON", "NODE_", "LD_"))}
        environment.pop("TRAVELOS_PARENT_PACKAGE_QUALIFICATION", None)
        if qualification is not None:
            environment["TRAVELOS_PARENT_PACKAGE_QUALIFICATION"] = json.dumps(qualification)
        return subprocess.call(["/usr/bin/unshare", "--user", "--map-root-user", "--mount", "--propagation", "private", "--fork", "/usr/bin/python3", "-I", "-c", CHILD, str(HERE), str(native), node, cosign], env=environment, close_fds=True)


if __name__ == "__main__":
    raise SystemExit(run())
