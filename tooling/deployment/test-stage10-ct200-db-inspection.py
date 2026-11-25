import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

MODULE = Path(__file__).with_name('stage10-ct200-db-inspection.py')


def load():
    spec = importlib.util.spec_from_file_location('stage10_db_inspection', MODULE)
    assert spec is not None and spec.loader is not None
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def rows():
    return [
        {'phase': 'session', 'currentUser': 'travelos_migrator', 'sessionUser': 'travelos_migrator', 'database': 'travelos_development'},
        {'phase': 'owner', 'currentUser': 'travelos_owner', 'sessionUser': 'travelos_migrator', 'superuser': False, 'createDb': False, 'createRole': False, 'replication': False, 'bypassRls': False, 'serverVersion': 180004},
        {'phase': 'ledger', 'count': 16, 'head': '0016_stage9_staff_invitations', 'names': [record['file'].removesuffix('.cjs') for record in json.loads((MODULE.parents[2] / 'migrations/checksums.json').read_text())['migrations']]},
    ]


class InspectionTest(unittest.TestCase):
    def test_implementation_exists(self):
        self.assertTrue(MODULE.is_file(), 'Missing fixed CT200 database inspector')

    def test_valid_exact_principals_and_ledger(self):
        result = load().decode_output('\n'.join(json.dumps(row) for row in rows()))
        self.assertEqual(result['result'], 'READ_ONLY_DATABASE_INSPECTION_PASS')
        self.assertEqual(result['migrationHead'], '0016_stage9_staff_invitations')
        self.assertEqual(result['backupRestore'], 'NOT_PERFORMED')

    def test_wrong_principal_privilege_ledger_or_unknown_fields_rejected(self):
        for index, key, value in [(0, 'currentUser', 'postgres'), (1, 'superuser', True), (1, 'sessionUser', 'travelos_owner'), (1, 'serverVersion', 170001), (2, 'count', 15), (2, 'count', True), (2, 'head', 'unexpected'), (0, 'unknown', 'not-allowed')]:
            data = rows()
            data[index][key] = value
            with self.subTest(index=index, key=key):
                with self.assertRaises(ValueError):
                    load().decode_output('\n'.join(json.dumps(row) for row in data))

    def test_missing_extra_duplicate_keys_and_oversized_output_rejected(self):
        decoder = load().decode_output
        for output in ['', '{}', '\n'.join(json.dumps(row) for row in rows() * 2), '{"phase":"session","phase":"owner"}', 'x' * 16385]:
            with self.subTest(output_size=len(output)):
                with self.assertRaises(ValueError):
                    decoder(output)

    def test_substituted_or_reordered_ledger_with_same_count_and_head_rejected(self):
        for change in ('substitute', 'reorder'):
            data = rows()
            if change == 'substitute':
                data[2]['names'][3] = '0004_substituted'
            else:
                data[2]['names'][0], data[2]['names'][1] = data[2]['names'][1], data[2]['names'][0]
            with self.assertRaises(ValueError):
                load().decode_output('\n'.join(json.dumps(row) for row in data))

    def test_modified_pinned_public_host_key_rejected_before_ssh(self):
        module = load()
        with patch.object(module, 'KNOWN_HOSTS') as known_hosts:
            known_hosts.read_bytes.return_value = b'unrecognized-public-host-key\n'
            with self.assertRaises(ValueError):
                module.inspect()

    def test_cli_rejects_options_without_remote_execution(self):
        for args in [[], ['--inspect', '--host=other'], ['--sql=SELECT 1'], ['--inspect', '--inspect']]:
            result = subprocess.run([sys.executable, '-I', str(MODULE), *args], capture_output=True, text=True, timeout=5)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('travelos_migrator|', result.stdout)


if __name__ == '__main__':
    unittest.main()
