"""Adversarial launcher tests; all adversarial calls run in sacrificial mounts."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
RUNNER = HERE / "run-stage10-signature-tests.py"
NODE = os.environ.get("TRAVELOS_NODE", "/usr/bin/node")

# Never reproduce the old forged-claim bug against the caller's /etc or /opt.
SANDBOX = r'''
import json, os, subprocess, sys
if os.environ.get("TRAVELOS_PROBE_DENY_SYSCALL"):
    import ctypes, ctypes.util
    library_name = ctypes.util.find_library("seccomp")
    assert library_name, "libseccomp is required for kernel failure injection"
    library = ctypes.CDLL(library_name)
subprocess.run(["/usr/bin/mount", "--make-rprivate", "/"], check=True)
for directory in ("/etc", "/opt"):
    subprocess.run(["/usr/bin/mount", "-t", "tmpfs", "tmpfs", directory], check=True)
    with open(directory + "/outer-sentinel", "w") as stream: stream.write("preserve")
fds = [os.open(directory, os.O_RDONLY | os.O_DIRECTORY) for directory in ("/etc", "/opt")]
env = dict(os.environ)
env["TRAVELOS_TEST_HOST"] = json.dumps({
    "hostUserNamespace": "user:[forged]", "hostMountNamespace": "mnt:[forged]",
    "hostEtcDevice": -1, "hostOptDevice": -1,
})
env["TRAVELOS_TEST_ISOLATION"] = json.dumps({
    **json.loads(env["TRAVELOS_TEST_HOST"]), "fd": fds[0], "optFd": fds[1],
})
env["TRAVELOS_COSIGN"] = "/nonexistent-must-not-be-executed"
# Inject real kernel EPERM, not a fake subprocess result. Install only after the
# sacrificial mounts exist; descendants inherit it and cannot disable it.
if os.environ.get("TRAVELOS_PROBE_DENY_SYSCALL"):
    library.seccomp_init.argtypes = [ctypes.c_uint32]
    library.seccomp_init.restype = ctypes.c_void_p
    library.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    library.seccomp_syscall_resolve_name.restype = ctypes.c_int
    library.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    library.seccomp_load.argtypes = [ctypes.c_void_p]
    library.seccomp_release.argtypes = [ctypes.c_void_p]
    context = library.seccomp_init(0x7fff0000)
    assert context
    number = library.seccomp_syscall_resolve_name(os.environ["TRAVELOS_PROBE_DENY_SYSCALL"].encode())
    assert number >= 0
    assert library.seccomp_rule_add(context, 0x50001, number, 0) == 0
    assert library.seccomp_load(context) == 0
    library.seccomp_release(context)
result = subprocess.run(sys.argv[1:], env=env, pass_fds=tuple(fds), capture_output=True, text=True)
for directory in ("/etc", "/opt"):
    assert open(directory + "/outer-sentinel").read() == "preserve"
    assert not os.path.exists(directory + "/travelos"), "outer mount was modified"
print(json.dumps({"code": result.returncode, "stdout": result.stdout, "stderr": result.stderr}))
'''

PROBE = '''#!/usr/bin/python3
import json, os
assert os.getuid() == 0
assert not os.path.exists("/etc/outer-sentinel")
assert not os.path.exists("/opt/outer-sentinel")
assert "TRAVELOS_TEST_HOST" not in os.environ
assert "TRAVELOS_TEST_ISOLATION" not in os.environ
for mount in ("/etc", "/opt"):
    fd = os.open(mount, os.O_RDONLY | os.O_DIRECTORY)
    mount_id = next(line.split()[1] for line in open("/proc/self/fdinfo/%d" % fd) if line.startswith("mnt_id:"))
    entries = [line for line in open("/proc/self/mountinfo") if line.split()[0] == mount_id]
    os.close(fd)
    assert len(entries) == 1 and " - tmpfs " in entries[0]
    assert not any(tag in entries[0] for tag in ("shared:", "master:", "propagate_from:"))
print(json.dumps({"freshPrivateMounts": True}))
'''


class LauncherTests(unittest.TestCase):
    def sandbox(self, command, **environment):
        result = subprocess.run([
            "/usr/bin/unshare", "--user", "--map-root-user", "--mount", "--fork",
            "/usr/bin/python3", "-I", "-c", SANDBOX, *map(str, command),
        ], env={**os.environ, **environment}, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_namespace_failure_never_executes_fixture_or_falls_back(self):
        result = self.sandbox(["/usr/bin/python3", RUNNER],
                              TRAVELOS_NODE="/must-not-execute", TRAVELOS_PROBE_DENY_SYSCALL="unshare")
        self.assertNotEqual(result["code"], 0, result)
        self.assertEqual(result["stdout"], "")
        self.assertIn("Operation not permitted", result["stderr"])

    def test_mount_failure_never_executes_fixture_or_falls_back(self):
        result = self.sandbox(["/usr/bin/python3", RUNNER],
                              TRAVELOS_NODE="/must-not-execute", TRAVELOS_PROBE_DENY_SYSCALL="mount")
        self.assertNotEqual(result["code"], 0, result)
        self.assertEqual(result["stdout"], "")
        self.assertIn("Operation not permitted", result["stderr"])
        self.assertNotIn("must-not-execute", result["stderr"])

    def test_private_child_argument_cannot_skip_outer_launcher(self):
        # The old caller-reachable child branch trusts forged host identities.
        with tempfile.TemporaryDirectory(prefix="travelos-launcher-", dir=os.environ["TMPDIR"]) as root:
            probe = Path(root) / "probe"
            probe.write_text("#!/usr/bin/python3\n")
            probe.chmod(0o700)
            result = self.sandbox(["/usr/bin/python3", RUNNER, "--private-child"], TRAVELOS_NODE=str(probe))
        self.assertNotEqual(result["code"], 0, result)
        self.assertIn("USAGE", result["stderr"])

    def test_raw_node_with_forged_claims_still_creates_fresh_mounts(self):
        # Restoring an env-controlled 'already isolated' branch breaks this test.
        with tempfile.TemporaryDirectory(prefix="travelos-launcher-", dir=os.environ["TMPDIR"]) as root:
            probe = Path(root) / "probe"
            probe.write_text(PROBE)
            probe.chmod(0o700)
            result = self.sandbox([NODE, HERE / "test-stage10-signature.mjs"], TRAVELOS_NODE=str(probe))
        self.assertEqual(result["code"], 0, result)
        self.assertEqual(json.loads(result["stdout"]), {"freshPrivateMounts": True})

    def test_runner_discards_forged_claims_and_mounts_fresh(self):
        with tempfile.TemporaryDirectory(prefix="travelos-launcher-", dir=os.environ["TMPDIR"]) as root:
            probe = Path(root) / "probe"
            probe.write_text(PROBE)
            probe.chmod(0o700)
            result = self.sandbox(["/usr/bin/python3", RUNNER], TRAVELOS_NODE=str(probe))
        self.assertEqual(result["code"], 0, result)
        self.assertEqual(json.loads(result["stdout"]), {"freshPrivateMounts": True})


if __name__ == "__main__":
    unittest.main()
