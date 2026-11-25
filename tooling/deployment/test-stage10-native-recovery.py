import importlib.util
import pathlib
import os
import tempfile
import unittest
from unittest import mock

p = pathlib.Path(__file__).with_name('stage10-native-recovery.py')
s = importlib.util.spec_from_file_location('recovery', p)
m = importlib.util.module_from_spec(s)
s.loader.exec_module(m)

class RecoveryTest(unittest.TestCase):
    def test_root_rejected(self):
        with mock.patch.object(m.os, 'getuid', return_value=0), mock.patch.object(m.os, 'geteuid', return_value=0):
            with self.assertRaisesRegex(ValueError, '^STAGE10_RECOVERY_REJECTED$'):
                m.recover_native_tar(b'x', {}, '/run/user/1')

    def test_missing_tools_rejected_without_details(self):
        with mock.patch.object(m, '_preflight'):
            with self.assertRaisesRegex(ValueError, '^STAGE10_RECOVERY_REJECTED$'):
                m.recover_native_tar(b'x', {}, '/run/user/1')

    def test_no_swap_rejected(self):
        with mock.patch.object(m, '_swap_disabled', return_value=False), mock.patch.object(m.os, 'getuid', return_value=123), mock.patch.object(m.os, 'geteuid', return_value=123):
            with self.assertRaises(ValueError):
                m._preflight('/run/user/123')

    def test_invalid_query_result_rejected(self):
        with self.assertRaises(ValueError):
            m._check_result({'adminTripSelect': True})

    def test_bad_archive_and_wrong_pin_have_immutable_error(self):
        tools = {k: {'path': '/nonexistent/private', 'sha256': '0' * 64} for k in
                 ('pg_ctl','postgres','psql','pg_verifybackup','pg_waldump')}
        with mock.patch.object(m, '_preflight'):
            for archive in (b'', b'not a tar'):
                with self.assertRaisesRegex(ValueError, '^STAGE10_RECOVERY_REJECTED$'):
                    m.recover_native_tar(archive, tools, '/run/user/1')

    def test_fixed_query(self):
        self.assertIn('travelos_admin_runtime', m.SQL)
        self.assertIn('travelos_portal_runtime', m.SQL)
        self.assertNotIn('_api', m.SQL)

class CleanupTest(unittest.TestCase):
    def setUp(self):
        scratch = os.environ.get('TMPDIR', str(pathlib.Path.home()/'.hermes/cache/scratch'))
        self.temporary = tempfile.TemporaryDirectory(dir=scratch, prefix='recovery-cleanup-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)/'clone-root'
        self.clone, self.sock = self.root/'db', self.root/'s'
        self.clone.mkdir(parents=True); self.sock.mkdir()
        self.marker = self.root/'retained'
        self.marker.write_text('synthetic retained marker')

    def cleanup(self, run, pid: int | None=123456789, confirmed=True):
        return m._cleanup_recovery(self.root, self.clone, self.sock, True,
                                   confirmed, pid, run, ['-D', str(self.clone)])

    def test_fast_stop_failure_escalates_then_removes_stopped_clone(self):
        run = mock.Mock(side_effect=[ValueError('synthetic fast-stop failure'), b''])
        with mock.patch.object(m.os, 'kill', side_effect=ProcessLookupError):
            self.assertFalse(self.cleanup(run))
        self.assertEqual([call.args[1][-2] for call in run.call_args_list], ['fast', 'immediate'])
        self.assertTrue(all(call.kwargs['timeout'] == 35 for call in run.call_args_list))
        self.assertFalse(self.root.exists())

    def test_both_stops_fail_preserves_root(self):
        run = mock.Mock(side_effect=ValueError('synthetic stop failure'))
        with mock.patch.object(m.shutil, 'rmtree') as remove:
            self.assertTrue(self.cleanup(run))
            remove.assert_not_called()
        self.assertTrue(self.marker.exists())

    def test_live_pid_after_successful_stop_preserves_root(self):
        with mock.patch.object(m.os, 'kill', return_value=None), mock.patch.object(m.shutil, 'rmtree') as remove:
            self.assertTrue(self.cleanup(mock.Mock(return_value=b'')))
            remove.assert_not_called()
        self.assertTrue(self.marker.exists())

    def test_unconfirmed_start_without_pid_preserves_root(self):
        run = mock.Mock()
        self.assertTrue(self.cleanup(run, pid=None, confirmed=False))
        run.assert_not_called()
        self.assertTrue(self.marker.exists())

    def test_remaining_socket_or_pidfile_preserves_root(self):
        for file in (self.sock/'.s.PGSQL.6544', self.clone/'postmaster.pid'):
            file.write_text('123456789')
            with mock.patch.object(m.os, 'kill', side_effect=ProcessLookupError), mock.patch.object(m.shutil, 'rmtree') as remove:
                self.assertTrue(self.cleanup(mock.Mock(return_value=b'')))
                remove.assert_not_called()
            file.unlink()

    def test_cleanup_filesystem_failure_is_not_success(self):
        with mock.patch.object(m.os, 'kill', side_effect=ProcessLookupError), mock.patch.object(m.shutil, 'rmtree', side_effect=OSError('synthetic deletion failure')):
            self.assertTrue(self.cleanup(mock.Mock(return_value=b'')))
        self.assertTrue(self.marker.exists())

    def test_invalid_pid_never_invokes_stop(self):
        run = mock.Mock()
        self.assertTrue(self.cleanup(run, pid=1))
        run.assert_not_called()
        self.assertTrue(self.marker.exists())


if __name__ == '__main__':
    unittest.main()
