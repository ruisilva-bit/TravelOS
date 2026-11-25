"""Resource-boundary invariants for the CT200 synthetic qualification unit."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    'stage10_qualification_resource',
    Path(__file__).with_name('stage10-qualification-resource.py'))
resource = importlib.util.module_from_spec(SPEC)
if SPEC.loader:
    SPEC.loader.exec_module(resource)

class ResourceBoundaryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / 'user.slice/user-1000.slice/user@1000.service/app.slice/travelos-s10-attempt-abc.service'
        self.root.mkdir(parents=True)
        for name, value in {
            'memory.max': '2147483648\n', 'memory.swap.max': '0\n',
            'memory.swap.current': '0\n', 'pids.max': '128\n',
            'cpu.max': '100000 100000\n',
        }.items():
            (self.root / name).write_text(value)

    def check(self):
        return resource.check_resource_boundary(self.root, uid=1000, core_limits=(0, 0))

    def test_accepts_exact_effective_cgroup_limits(self):
        observed = self.check()
        self.assertEqual(observed['memoryMaxBytes'], 2147483648)
        self.assertEqual(observed['memorySwapMaxBytes'], 0)
        self.assertEqual(observed['pidsMax'], 128)
        self.assertEqual(observed['cpuMax'], '100000 100000')

    def test_rejects_wrong_uid_or_unbounded_resource(self):
        with self.assertRaises(ValueError):
            resource.check_resource_boundary(self.root, uid=0, core_limits=(0, 0))
        for name, bad in [('memory.max', 'max'), ('pids.max', 'max'),
                          ('cpu.max', 'max 100000'), ('memory.swap.max', '1'),
                          ('memory.swap.current', '1')]:
            with self.subTest(name=name):
                target = self.root / name
                old = target.read_text()
                target.write_text(bad)
                with self.assertRaises(ValueError):
                    self.check()
                target.write_text(old)

    def test_rejects_core_dumps_and_missing_or_non_user_cgroup(self):
        with self.assertRaises(ValueError):
            resource.check_resource_boundary(self.root, uid=1000, core_limits=(0, -1))
        (self.root / 'memory.max').unlink()
        with self.assertRaises(ValueError):
            self.check()
        self.root.rename(self.root.with_name('renamed.service'))
        with self.assertRaises(ValueError):
            resource.check_resource_boundary(self.root.with_name('renamed.service'),
                                             uid=1000, core_limits=(0, 0))

    def test_launcher_requires_exact_executable_and_private_attempt(self):
        attempt = Path('/home/hermes/.local/share/travelos-stage10-qualification/attempt-abc')
        args = resource.unit_command('travelos-s10-attempt-abc', attempt)
        self.assertEqual(args[0:3], ['/usr/bin/systemd-run', '--user', '--collect'])
        self.assertIn('MemorySwapMax=0', args)
        self.assertIn('LimitCORE=0', args)
        self.assertEqual(args[-4:], ['/usr/bin/python3', '-B', '-I', str(attempt / 'harness/resource.py')])
        for invalid in ('/opt/travelos/current', '/home/hermes/attempt',
                        '/home/hermes/.local/share/travelos-stage10-qualification/../escape'):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                resource.unit_command('travelos-s10-attempt-abc', Path(invalid))
        with self.assertRaises(ValueError):
            resource.unit_command('other.service', attempt)

if __name__ == '__main__':
    unittest.main()
