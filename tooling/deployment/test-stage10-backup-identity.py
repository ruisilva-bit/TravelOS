#!/usr/bin/env python3
"""Test-first contract for stage10-backup-identity; all host effects are fake.

Proposed API: provision(host), check(host) -> {'state': ...}. Both receive
an injected host implementing FakeHost's methods. PublicationUncertain is
raised by the adapter when an effect may have published. State strings are
PROVISIONED, VERIFIED, REJECTED, ROLLED_BACK, RECONCILIATION_REQUIRED.
The adapter encrypt_snapshot must durably publish ciphertext before returning;
publish_hba replaces the complete file. Identifiers/rules are fixed below.
No fixture invokes system utilities, PostgreSQL, a root boundary, or CT200.
"""
import importlib.util
from pathlib import Path
import unittest

FILE = Path(__file__).with_name('stage10-backup-identity.py')
module = None
if FILE.is_file():
    spec = importlib.util.spec_from_file_location('stage10_backup_identity', FILE)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
assert module is not None, 'stage10-backup-identity.py is not implemented'

USER = 'travelos_backup'
ROLE = 'travelos_backup'
RULES = ('local replication travelos_backup peer\n'
         'local postgres travelos_backup peer\n')
ORIGINAL = '# original\nlocal all all peer\n'


class FakeHost:
    """In-memory host with explicit pre/post-effect fault injection."""
    def __init__(self):
        self.users = set()
        self.roles = set()
        self.journal = None
        self.hba = ORIGINAL
        self.snapshot = None
        self.role_valid = True
        self.peer_valid = True
        self.events = []
        self.fail: str | None = None

    def user_exists(self, name): return name in self.users
    def role_exists(self, name): return name in self.roles
    def read_journal(self): return self.journal
    def read_hba(self): return self.hba
    def encrypt_snapshot(self, contents):
        self.events.append('snapshot')
        if self.fail == 'snapshot': raise OSError('snapshot failed')
        self.snapshot = b'encrypted-fixture:' + contents.encode()[::-1]
    def write_journal(self, state):
        self.events.append('journal:' + state)
        self.journal = state
        if self.fail == 'journal_uncertain':
            raise module.PublicationUncertain('synthetic ambiguous journal')
    def create_user(self, name):
        self.events.append('create_user')
        if self.fail == 'user': raise OSError('user failed')
        self.users.add(name)
        if self.fail == 'user_uncertain':
            raise module.PublicationUncertain('synthetic ambiguous user creation')
    def create_role(self, name):
        self.events.append('create_role')
        if self.fail == 'role': raise OSError('role failed')
        self.roles.add(name)
        if self.fail == 'role_uncertain':
            raise module.PublicationUncertain('synthetic ambiguous role creation')
    def publish_hba(self, contents):
        self.events.append('publish_hba')
        if self.fail == 'publish': raise OSError('synthetic pre-publication failure')
        self.hba = contents
        if self.fail == 'publish_uncertain':
            raise module.PublicationUncertain('synthetic ambiguous publication')
    def reload_hba(self):
        self.events.append('reload')
        if self.fail == 'reload_uncertain':
            raise module.PublicationUncertain('synthetic ambiguous reload')
    def verify_role(self, name): return name == ROLE and self.role_valid and name in self.roles
    def verify_peer(self, user, role):
        return user == USER and role == ROLE and self.peer_valid and user in self.users and role in self.roles
    def delete_role(self, name):
        self.events.append('delete_role')
        if self.fail == 'rollback': raise OSError('synthetic rollback failure')
        self.roles.remove(name)
    def delete_user(self, name):
        self.events.append('delete_user')
        self.users.remove(name)
    def restore_hba(self, contents):
        self.events.append('restore_hba')
        self.hba = contents


class IdentityContract(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(module, 'stage10-backup-identity.py is not implemented')
        self.host = FakeHost()

    def provision(self): return module.provision(self.host)
    def check(self): return module.check(self.host)

    def test_fresh_provision_snapshots_before_mutation_and_prepends_exact_rules(self):
        self.assertEqual(self.provision()['state'], 'PROVISIONED')
        self.assertEqual(self.host.users, {USER})
        self.assertEqual(self.host.roles, {ROLE})
        self.assertEqual(self.host.hba, RULES + ORIGINAL)
        self.assertIsNotNone(self.host.snapshot)
        self.assertNotIn(ORIGINAL.encode(), self.host.snapshot)
        self.assertLess(self.host.events.index('snapshot'), self.host.events.index('create_user'))
        self.assertLess(self.host.events.index('snapshot'), self.host.events.index('create_role'))
        self.assertLess(self.host.events.index('snapshot'), self.host.events.index('publish_hba'))
        self.assertLess(self.host.events.index('publish_hba'), self.host.events.index('reload'))

    def test_refuses_preexisting_user_role_or_journal_without_mutation(self):
        for existing in ('user', 'role', 'journal'):
            with self.subTest(existing=existing):
                host = FakeHost()
                if existing == 'user': host.users.add(USER)
                elif existing == 'role': host.roles.add(ROLE)
                else: host.journal = 'incomplete'
                before = (host.users.copy(), host.roles.copy(), host.journal, host.hba, host.snapshot)
                self.assertEqual(module.provision(host)['state'], 'REJECTED')
                self.assertEqual((host.users, host.roles, host.journal, host.hba, host.snapshot), before)
                self.assertEqual(host.events, [])

    def test_snapshot_failure_does_not_mutate_host(self):
        self.host.fail = 'snapshot'
        self.assertEqual(self.provision()['state'], 'REJECTED')
        self.assertEqual((self.host.users, self.host.roles, self.host.hba, self.host.journal),
                         (set(), set(), ORIGINAL, None))

    def test_role_creation_failure_rolls_back_only_created_user_and_keeps_snapshot(self):
        self.host.fail = 'role'
        self.assertEqual(self.provision()['state'], 'ROLLED_BACK')
        self.assertEqual((self.host.users, self.host.roles, self.host.hba), (set(), set(), ORIGINAL))
        self.assertNotIn('delete_role', self.host.events)
        self.assertIsNotNone(self.host.snapshot)

    def test_role_or_peer_verification_failure_rolls_back(self):
        for field in ('role_valid', 'peer_valid'):
            with self.subTest(field=field):
                host = FakeHost()
                setattr(host, field, False)
                self.assertEqual(module.provision(host)['state'], 'ROLLED_BACK')
                self.assertEqual((host.users, host.roles, host.hba), (set(), set(), ORIGINAL))
                self.assertIsNotNone(host.snapshot)

    def test_rollback_failure_requires_reconciliation(self):
        self.host.peer_valid = False
        self.host.fail = 'rollback'
        self.assertEqual(self.provision()['state'], 'RECONCILIATION_REQUIRED')
        self.assertIsNotNone(self.host.snapshot)
        self.assertIn(ROLE, self.host.roles)

    def test_ambiguous_post_publication_never_blindly_rolls_back(self):
        for point in ('publish_uncertain', 'reload_uncertain'):
            with self.subTest(point=point):
                host = FakeHost()
                host.fail = point
                self.assertEqual(module.provision(host)['state'], 'RECONCILIATION_REQUIRED')
                self.assertEqual(host.hba, RULES + ORIGINAL)
                self.assertEqual(host.users, {USER})
                self.assertEqual(host.roles, {ROLE})
                self.assertIsNotNone(host.snapshot)
                self.assertFalse({'delete_user', 'delete_role', 'restore_hba'} & set(host.events))

    def test_pre_effect_publish_error_rolls_back_without_restoring_hba(self):
        self.host.fail = 'publish'
        self.assertEqual(self.provision()['state'], 'ROLLED_BACK')
        self.assertEqual(self.host.hba, ORIGINAL)
        self.assertEqual((self.host.users, self.host.roles), (set(), set()))
        self.assertNotIn('restore_hba', self.host.events)

    def test_ambiguous_creation_and_journal_never_trigger_cleanup(self):
        for point in ('user_uncertain', 'role_uncertain', 'journal_uncertain'):
            with self.subTest(point=point):
                host = FakeHost()
                host.fail = point
                self.assertEqual(module.provision(host)['state'], 'RECONCILIATION_REQUIRED')
                self.assertFalse({'delete_user', 'delete_role', 'restore_hba'} & set(host.events))
                self.assertIsNotNone(host.snapshot)
                if point == 'user_uncertain':
                    self.assertIn(USER, host.users)
                if point == 'role_uncertain':
                    self.assertIn(ROLE, host.roles)

    def test_check_verified_and_failure_paths_are_read_only(self):
        for field in (None, 'role_valid', 'peer_valid'):
            with self.subTest(field=field):
                host = FakeHost()
                host.users.add(USER)
                host.roles.add(ROLE)
                host.hba = RULES + ORIGINAL
                host.journal = 'complete'
                if field: setattr(host, field, False)
                before = (host.users.copy(), host.roles.copy(), host.hba, host.journal, host.snapshot)
                self.assertEqual(module.check(host)['state'], 'VERIFIED' if field is None else 'REJECTED')
                self.assertEqual((host.users, host.roles, host.hba, host.journal, host.snapshot), before)
                self.assertEqual(host.events, [])

    def test_check_rejects_incorrect_hba_or_incomplete_journal_without_mutation(self):
        for hba, journal in ((ORIGINAL, 'complete'), (RULES + ORIGINAL, 'incomplete')):
            with self.subTest(hba=hba, journal=journal):
                host = FakeHost()
                host.users.add(USER); host.roles.add(ROLE)
                host.hba = hba; host.journal = journal
                self.assertEqual(module.check(host)['state'], 'REJECTED')
                self.assertEqual((host.hba, host.journal), (hba, journal))
                self.assertEqual(host.events, [])


if __name__ == '__main__':
    unittest.main()
