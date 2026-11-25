#!/usr/bin/python3
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('reconcile', HERE / 'stage10-reconcile-backup-identity.py')
module = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(module)
except FileNotFoundError:
    module = None

class ReconcileTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.state = self.root / 'state'
        self.state.mkdir(mode=0o700)
        self.cipher = b'fixture-ciphertext'
        self.original = b'original hba\n'
        self.rules = b'local replication travelos_backup peer\nlocal postgres travelos_backup peer\n'
        h = lambda b: hashlib.sha256(b).hexdigest()
        self.meta = dict(recipient='fixture', original_hba_sha256=h(self.original), bound_hba_sha256=h(self.rules+self.original), cipher_sha256=h(self.cipher), hba_uid=102, hba_gid=106, hba_mode=0o640, hba_bytes=len(self.original))
        for i, event in enumerate(('snapshot', 'started', 'user_intent', 'reconciliation_required')):
            self.put(f'{i:03}.json', (json.dumps(dict(version=1,sequence=i,event=event,metadata=self.meta))+'\n').encode())
        self.put('snapshot.cms', self.cipher)
        self.host = FixtureHost(self)

    def tearDown(self): self.tmp.cleanup()
    def put(self, name, data):
        p = self.state / name
        p.write_bytes(data)
        p.chmod(0o600)
    def run_it(self, fault=None):
        self.assertIsNotNone(module, 'reconciler is not implemented')
        return module._reconcile(self.host, str(self.root), 'state', 'archive', os.geteuid(), hashlib.sha256(self.cipher).hexdigest(), len(self.cipher), fault=fault)
    def test_archives_original_and_rearms_empty(self):
        self.run_it()
        self.assertEqual(sorted(os.listdir(self.state)), [])
        self.assertEqual((self.root/'archive'/'snapshot.cms').read_bytes(), self.cipher)
        self.assertEqual(len(list((self.root/'archive').iterdir())), 5)
    def test_rejects_extra_file(self):
        self.put('extra', b'x')
        with self.assertRaises(Exception): self.run_it()
        self.assertFalse((self.root/'archive').exists())
    def test_rejects_changed_hba_and_presence(self):
        for attr in ('changed', 'user', 'group', 'role'):
            setattr(self.host, attr, True)
            with self.assertRaises(Exception): self.run_it()
            setattr(self.host, attr, False)
        self.assertTrue(self.state.exists())
    def test_refuses_partial_publication_retry(self):
        def fault(stage):
            if stage == 'archived': raise OSError('injected crash')
        with self.assertRaises(Exception): self.run_it(fault)
        self.assertTrue((self.root/'archive'/'snapshot.cms').exists())
        self.assertFalse(self.state.exists())
        with self.assertRaises(Exception): self.run_it()
    def test_rejects_mutated_event_and_snapshot_permissions(self):
        path = self.state/'002.json'
        value = json.loads(path.read_text())
        value['event'] = 'role_intent'
        self.put('002.json', json.dumps(value).encode())
        with self.assertRaises(Exception): self.run_it()
        value['event'] = 'user_intent'
        self.put('002.json', json.dumps(value).encode())
        (self.state/'snapshot.cms').chmod(0o644)
        with self.assertRaises(Exception): self.run_it()
        self.assertFalse((self.root/'archive').exists())
    def test_refuses_after_verified_before_rearm(self):
        def fault(stage):
            if stage == 'verified': raise OSError('injected crash')
        with self.assertRaises(Exception): self.run_it(fault)
        self.assertTrue((self.root/'archive'/'snapshot.cms').exists())
        self.assertFalse(self.state.exists())
        with self.assertRaises(Exception): self.run_it()
    def test_rejects_symlink_and_hardlink(self):
        snapshot = self.state/'snapshot.cms'
        snapshot.unlink()
        other = self.root/'other'
        other.write_bytes(self.cipher); other.chmod(0o600)
        snapshot.symlink_to(other)
        with self.assertRaises(Exception): self.run_it()
        snapshot.unlink(); os.link(other, snapshot)
        with self.assertRaises(Exception): self.run_it()
        self.assertFalse((self.root/'archive').exists())
    def test_refuses_archive_collision(self):
        (self.root/'archive').mkdir()
        with self.assertRaises(Exception): self.run_it()
        self.assertTrue(self.state.exists())

class FixtureHost:
    def __init__(self, fixture):
        self.f = fixture
        self.changed = self.user = self.group = self.role = False
    def read_journal(self):
        self.events = [json.loads((self.f.state/f'{i:03}.json').read_bytes()) for i in range(4)]
        self.meta = self.events[-1]['metadata']
        return self.events[-1]['event']
    def read_hba(self): return 'changed' if self.changed else self.f.original.decode()
    def user_exists(self, name): return self.user
    def role_exists(self, name): return self.role
    def group_absent(self): return not self.group

if __name__ == '__main__': unittest.main()
