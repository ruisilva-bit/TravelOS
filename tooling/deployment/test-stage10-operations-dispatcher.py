import importlib.util
import io
import http.server
import threading
import unittest
import os
import tempfile
import json
from unittest.mock import patch
from contextlib import redirect_stdout
from pathlib import Path

FILE = Path(__file__).with_name('stage10-operations-dispatcher.py')


class DispatcherTests(unittest.TestCase):
    def load(self):
        self.assertTrue(FILE.exists(), 'bounded operational dispatcher must exist')
        spec = importlib.util.spec_from_file_location('operations', FILE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_unsupported_operations_and_arguments_are_rejected(self):
        module = self.load()
        for args in ([], ['restart'], ['migrate'], ['status', 'extra'], ['status;id'], ['activate', 'extra'], ['backup', '/tmp/x']):
            with self.subTest(args=args), redirect_stdout(io.StringIO()):
                self.assertNotEqual(module.dispatch(args), 0)

    def test_health_checks_real_loopback_http_and_rejects_error_status(self):
        module = self.load()
        class Handler(http.server.BaseHTTPRequestHandler):
            status = 200
            def do_GET(self):
                self.send_response(self.status if self.path == '/health/live' else 404)
                self.end_headers()
            def log_message(self, *args):
                pass
        server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        module.HEALTH_PORTS = (server.server_port, server.server_port)
        with redirect_stdout(io.StringIO()):
            self.assertEqual(module.dispatch(['health']), 0)
            Handler.status = 503
            self.assertNotEqual(module.dispatch(['health']), 0)

    def test_health_fails_closed_when_services_are_unreachable(self):
        module = self.load()
        module.HEALTH_PORTS = (1, 1)
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertNotEqual(module.dispatch(['health']), 0)
        self.assertIn('UNHEALTHY', out.getvalue())

    def test_status_does_not_report_unknown_services_as_active(self):
        module = self.load()
        module.SYSTEMCTL = '/nonexistent/systemctl'
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertNotEqual(module.dispatch(['status']), 0)
        self.assertIn('UNAVAILABLE', out.getvalue())

    def test_service_report_runs_fixed_commands_and_sanitizes_output(self):
        module = self.load()
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as tmp:
            tool = Path(tmp) / 'systemctl'
            log = Path(tmp) / 'calls'
            tool.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> ' + str(log) + '\nprintf "sensitive output\\n"\ncase "$3" in *portal*) exit 3;; esac\nexit 0\n')
            tool.chmod(0o700)
            module.SYSTEMCTL = str(tool)
            out = io.StringIO()
            with patch.dict(os.environ, {'SECRET_SENTINEL': 'sensitive output'}), redirect_stdout(out):
                self.assertNotEqual(module.dispatch(['service-report']), 0)
            self.assertEqual(json.loads(out.getvalue()), {'result': 'UNAVAILABLE', 'services': {
                'travelos-admin-api.service': 'ACTIVE',
                'travelos-portal-api.service': 'UNAVAILABLE',
                'travelos-worker.service': 'ACTIVE'}})
            self.assertEqual(log.read_text().splitlines(), ['is-active --quiet ' + unit for unit in module.UNITS])
            self.assertNotIn('sensitive output', out.getvalue())
            with redirect_stdout(io.StringIO()):
                self.assertNotEqual(module.dispatch(['service-report', 'other.service']), 0)

    def test_service_report_succeeds_only_when_every_fixed_unit_is_active(self):
        module = self.load()
        module.SYSTEMCTL = '/usr/bin/true'
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(module.dispatch(['service-report']), 0)
        report = json.loads(out.getvalue())
        self.assertEqual(report['result'], 'ACTIVE')
        self.assertEqual(report['services'], dict.fromkeys(module.UNITS, 'ACTIVE'))

    def test_service_report_timeout_is_unavailable(self):
        module = self.load()
        with patch.object(module.subprocess, 'run', side_effect=module.subprocess.TimeoutExpired('systemctl', 3)), redirect_stdout(io.StringIO()) as out:
            self.assertNotEqual(module.dispatch(['service-report']), 0)
        self.assertEqual(set(json.loads(out.getvalue())['services'].values()), {'UNAVAILABLE'})

    def test_service_report_fails_closed_if_executable_missing(self):
        module = self.load()
        module.SYSTEMCTL = '/nonexistent/systemctl'
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertNotEqual(module.dispatch(['service-report']), 0)
        report = json.loads(out.getvalue())
        self.assertEqual(report['result'], 'UNAVAILABLE')
        self.assertEqual(set(report['services'].values()), {'UNAVAILABLE'})

    def test_backup_fails_closed_without_qualified_backup_capability(self):
        module = self.load()
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertNotEqual(module.dispatch(['backup']), 0)
        self.assertIn('NOT_IMPLEMENTED', out.getvalue())

    def test_diagnostics_reports_real_disk_capacity_without_environment(self):
        module = self.load()
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(module.dispatch(['diagnostic']), 0)
        value = __import__('json').loads(out.getvalue())
        self.assertEqual(value['result'], 'DIAGNOSTIC')
        self.assertGreater(value['rootAvailableBytes'], 0)
        self.assertNotIn('PATH', out.getvalue())


if __name__ == '__main__':
    unittest.main()
