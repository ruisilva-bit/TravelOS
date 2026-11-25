"""Focused fail-closed remote orchestrator fixtures; no CT200 access."""
import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SOURCE = Path(__file__).with_name('stage10-qualification-remote.py')
SPEC = importlib.util.spec_from_file_location('remote_qual', SOURCE)
remote = importlib.util.module_from_spec(SPEC)
if SOURCE.exists():
    SPEC.loader.exec_module(remote)


class RemoteTests(unittest.TestCase):
    def test_valid_attempt_and_bounded_command(self):
        attempt = Path('/home/hermes/.local/share/travelos-stage10-qualification/attempt-abc')
        self.assertEqual(remote.attempt_path(str(attempt)), attempt)
        args = remote.unit_command(attempt)
        self.assertIn('--unit=travelos-s10-attempt-abc', args)
        self.assertIn('MemorySwapMax=0', args)
        self.assertIn('RuntimeMaxSec=900', args)
        self.assertEqual(args[-6:-3], ['/usr/bin/python3', '-B', '-I'])
        self.assertNotIn('sudo', ' '.join(args))
        for invalid in ['/tmp/attempt-abc', str(attempt) + '/..', str(attempt).replace('abc', 'x')]:
            with self.assertRaises(ValueError):
                remote.attempt_path(invalid)

    def test_user_bus_environment_is_explicit_for_launch_and_cleanup(self):
        with tempfile.TemporaryDirectory() as scratch, mock.patch.object(remote, 'ATTEMPT_PARENT', Path(scratch)):
            attempt = Path(scratch) / 'attempt-abc'
            attempt.mkdir(mode=0o700)
            with mock.patch.object(remote, 'prepare'), mock.patch.object(remote.subprocess, 'run', return_value=mock.Mock(returncode=1, stdout=b'', stderr=b'')) as proc:
                remote.run(attempt)
                self.assertEqual(proc.call_args.kwargs['env']['XDG_RUNTIME_DIR'], '/run/user/1000')
                self.assertEqual(proc.call_args.kwargs['env']['DBUS_SESSION_BUS_ADDRESS'], 'unix:path=/run/user/1000/bus')

    def test_failed_and_unknown_exit_never_pass_or_remove_attempt(self):
        with tempfile.TemporaryDirectory() as scratch:
            attempt = Path(scratch) / 'attempt-abc'
            attempt.mkdir()
            (attempt / 'marker').write_text('keep')
            for primary, verified in [(1, True), (None, True), (0, False)]:
                self.assertNotEqual(remote.classify(primary, verified), 'PASS')
                self.assertEqual((attempt / 'marker').read_text(), 'keep')
            self.assertEqual(remote.classify(0, True), 'PASS')

    def test_child_refuses_missing_inputs_before_running_any_process(self):
        with tempfile.TemporaryDirectory() as scratch, mock.patch.object(remote, 'ATTEMPT_PARENT', Path(scratch)):
            attempt = Path(scratch) / 'attempt-abc'
            attempt.mkdir(mode=0o700)
            with mock.patch.object(remote.subprocess, 'run') as run:
                with self.assertRaises((ValueError, FileNotFoundError)):
                    remote.child(attempt)
                run.assert_not_called()

    def test_completed_requires_exact_success_and_owned_cleanup(self):
        with tempfile.TemporaryDirectory() as scratch, mock.patch.object(remote, 'ATTEMPT_PARENT', Path(scratch)):
            attempt = Path(scratch) / 'attempt-abc'
            attempt.mkdir(mode=0o700)
            (attempt / 'remote-outcome.json').write_text(json.dumps({
                'result': 'PASS', 'primaryExit': 0, 'executionSha256': 'a' * 64,
                'cleanup': {'clusterStopped': True, 'disposableRootsAbsent': True}}))
            with self.assertRaises((ValueError, FileNotFoundError)):
                remote.completed(attempt)  # Missing verified execution and exact inventory.

    def test_run_preserves_primary_failure_and_unknown_unit_outcome(self):
        with tempfile.TemporaryDirectory() as scratch, mock.patch.object(remote, 'ATTEMPT_PARENT', Path(scratch)):
            attempt = Path(scratch) / 'attempt-abc'
            attempt.mkdir(mode=0o700)
            with mock.patch.object(remote, 'prepare'), mock.patch.object(remote.subprocess, 'run', return_value=mock.Mock(returncode=0, stdout=b'', stderr=b'')):
                self.assertEqual(remote.run(attempt), 'UNKNOWN_OUTCOME_PRESERVE')
            attempt = Path(scratch) / 'attempt-def'
            attempt.mkdir(mode=0o700)
            (attempt / 'remote-outcome.json').write_text(json.dumps({'result': 'FAIL_PRESERVE', 'primaryExit': 7}))
            with mock.patch.object(remote, 'prepare'), mock.patch.object(remote.subprocess, 'run', return_value=mock.Mock(returncode=7, stdout=b'', stderr=b'')):
                self.assertEqual(remote.run(attempt), 'FAIL_PRESERVE')
            self.assertTrue((attempt / 'remote-outcome.json').exists())

    def test_browser_nested_inventory_is_checked_before_process(self):
        with tempfile.TemporaryDirectory() as scratch, mock.patch.object(remote, 'ATTEMPT_PARENT', Path(scratch)):
            attempt = Path(scratch) / 'attempt-abc'
            attempt.mkdir(mode=0o700)
            for name in ('harness', 'runtime', 'browser/chromium_headless_shell-1234'):
                (attempt / name).mkdir(parents=True)
            fake = mock.Mock()
            fake.inventory.side_effect = lambda p: [{'path': 'ok'}] if p.name != 'chromium_headless_shell-1234' else [{'path': 'drift'}]
            for prefix in ('harness', 'runtime', 'browser'):
                (attempt / (prefix + '.receipt.json')).write_text(json.dumps({'files': [{'path': 'ok'}]}))
            with mock.patch.object(remote, 'checked', return_value=(fake, {})), mock.patch.object(remote, 'sibling') as sibling, mock.patch.object(remote.subprocess, 'run') as run:
                sibling.return_value = mock.Mock()
                with mock.patch.object(remote.json, 'loads', return_value={'files': [{'path': 'ok'}]}):
                    with self.assertRaisesRegex(ValueError, 'STAGE10_EXTRACTED_DRIFT'):
                        remote.child(attempt)
                run.assert_not_called()

    def test_primary_exit_is_not_replaced_by_wrapper_status(self):
        with tempfile.TemporaryDirectory() as scratch:
            attempt = Path(scratch)
            (attempt / 'remote-outcome.json').write_text(json.dumps({'result': 'FAIL_PRESERVE', 'primaryExit': 7}))
            self.assertEqual(remote.exit_status(attempt, 'FAIL_PRESERVE'), 7)
            self.assertEqual(remote.exit_status(attempt, 'UNKNOWN_OUTCOME_PRESERVE'), 1)
            self.assertEqual(remote.exit_status(attempt, 'PASS'), 0)

    def test_completed_receipt_and_cleanup_inverse(self):
        with tempfile.TemporaryDirectory() as scratch, mock.patch.object(remote, 'ATTEMPT_PARENT', Path(scratch)):
            attempt = Path(scratch) / 'attempt-abc'
            attempt.mkdir(mode=0o700)
            for name in remote.FILES + ('manifest.json', 'stdout.log', 'stderr.log', 'unit-stdout.log', 'unit-stderr.log'):
                (attempt / name).write_bytes(b'')
            for name in ('harness', 'runtime', 'browser/chromium_headless_shell-1234', 'scratch'):
                (attempt / name).mkdir(parents=True, exist_ok=True)
            evidence = attempt / 'harness/.hermes/state/ct200-run'
            evidence.mkdir(parents=True)
            execution = evidence / 'execution.json'
            cleanup = {'clusterStopped': True, 'disposableRootsAbsent': True}
            execution.write_text(json.dumps({'result': 'PASS', 'testExitCode': 0,
                'cleanup': cleanup, 'assertionCoverage': {'expectedTests': 95},
                'assertionResults': [{'status': 'passed'}] * 95}))
            digest = hashlib.sha256(execution.read_bytes()).hexdigest()
            (attempt / 'remote-outcome.json').write_text(json.dumps({'result': 'PASS',
                'primaryExit': 0, 'executionSha256': digest, 'cleanup': cleanup}))
            for prefix in ('harness', 'runtime', 'browser'):
                (attempt / (prefix + '.receipt.json')).write_text(json.dumps({'files': []}))
            transport = mock.Mock()
            transport.inventory.return_value = []
            with mock.patch.object(remote, 'checked_completed_inputs', return_value=(transport, {})):
                self.assertEqual(remote.completed(attempt)['executionSha256'], digest)
                self.assertEqual(transport.inventory.call_args_list[-1].args[0],
                                 attempt / 'browser/chromium_headless_shell-1234')
                with self.assertRaisesRegex(ValueError, 'STAGE10_EXTERNAL_RECEIPT_MISMATCH'):
                    remote.cleanup(attempt, '0' * 64)
                self.assertTrue(attempt.exists())
                (attempt / 'unexpected').touch()
                with self.assertRaisesRegex(ValueError, 'STAGE10_COMPLETED_FILES_REJECTED'):
                    remote.completed(attempt)
                self.assertTrue(attempt.exists())


if __name__ == '__main__':
    unittest.main()
