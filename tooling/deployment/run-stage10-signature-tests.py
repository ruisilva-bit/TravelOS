"""Construct fresh user/mount namespaces before executing synthetic tests.

No caller-reachable child mode, isolation assertions, inherited descriptors,
sudo, or fallback. New tmpfs mounts replace /etc and /opt on EVERY execution.
The JS fixture module can only emit its private program or invoke this runner.
"""
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent

# Not a second CLI mode: this code is supplied directly to unshare's child.
# Even executing it independently still constructs fresh private mounts first.
CHILD = r'''
import os, subprocess, sys
from pathlib import Path
node, here = sys.argv[1:]
subprocess.run(["/usr/bin/mount", "--make-rprivate", "/"], check=True)
for directory in ("/etc", "/opt"):
    subprocess.run([
        "/usr/bin/mount", "-t", "tmpfs", "-o", "mode=0755,nodev,nosuid", "tmpfs", directory,
    ], check=True)
os.mkdir("/etc/travelos", 0o700)
# Source emission does not register/run tests. Its output is executed only here,
# after both mounts succeeded. cwd fixes the eval module's relative imports.
program = subprocess.check_output([
    node, str(Path(here) / "test-stage10-signature.mjs"), "--emit-private-test-program",
], cwd=here, text=True)
raise SystemExit(subprocess.run([
    node, "--input-type=module",
], input=program, cwd=here, text=True).returncode)
'''


def run():
    if sys.argv[1:]:
        raise SystemExit("USAGE: python3 run-stage10-signature-tests.py")
    environment = dict(os.environ)
    # Discard legacy claims, all descriptor claims, and interpreter injection.
    for name in list(environment):
        if (name.startswith(("TRAVELOS_TEST_", "PYTHON"))
                or name in ("NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_LIBRARY_PATH")):
            del environment[name]
    node = environment.get("TRAVELOS_NODE", "/usr/bin/node")
    if not os.path.isabs(node):
        raise SystemExit("ABSOLUTE_NODE_REQUIRED")
    return subprocess.call([
        "/usr/bin/unshare", "--user", "--map-root-user", "--mount", "--fork",
        sys.executable, "-I", "-c", CHILD, node, str(HERE),
    ], env=environment, close_fds=True)


if __name__ == "__main__":
    raise SystemExit(run())
