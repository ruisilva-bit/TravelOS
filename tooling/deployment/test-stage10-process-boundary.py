import importlib.util
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

MODULE = Path(__file__).with_name('stage10-process-boundary.py')


def load():
    spec = importlib.util.spec_from_file_location('stage10_process_boundary', MODULE)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BoundaryTest(unittest.TestCase):
    def test_implementation_exists(self):
        self.assertTrue(MODULE.is_file(), 'Missing bounded operational subprocess mechanism')

    def test_stdout_and_stderr_are_bounded_while_streaming(self):
        run = load().bounded_run
        for stream in ['stdout', 'stderr']:
            started = time.monotonic()
            with self.assertRaises(ValueError):
                run([sys.executable, '-c', f'import sys; sys.{stream}.buffer.write(b"x"*16000000);sys.{stream}.flush()'], output_limit=1024, timeout=5)
            self.assertLess(time.monotonic() - started, 5)

    def test_large_stdin_and_output_are_multiplexed_without_deadlock(self):
        data = b'synthetic' * 50000
        result = load().bounded_run([sys.executable, '-c', 'import sys;sys.stdout.buffer.write(b"prefix");sys.stdout.flush();data=sys.stdin.buffer.read();sys.stdout.buffer.write(data)'], data=data, output_limit=len(data) + 100, timeout=5)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b'prefix' + data)

    def test_timeout_and_nonzero_exit_have_distinct_results(self):
        run = load().bounded_run
        with self.assertRaises(ValueError):
            run([sys.executable, '-c', 'import time;time.sleep(10)'], timeout=0.1)
        self.assertEqual(run([sys.executable, '-c', 'raise SystemExit(7)']).returncode, 7)

    def test_invalid_policy_is_rejected_before_child_creation(self):
        module = load()
        for options in [{'data': 'not-bytes'}, {'timeout': float('nan')}, {'timeout': float('inf')}, {'timeout': 0}, {'output_limit': True}]:
            with patch.object(module.subprocess, 'Popen') as popen:
                with self.assertRaises(ValueError):
                    module.bounded_run([sys.executable, '-c', 'raise SystemExit(0)'], **options)
                popen.assert_not_called()


if __name__ == '__main__':
    unittest.main()
