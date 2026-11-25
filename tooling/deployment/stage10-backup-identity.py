"""Backup-identity orchestration; no privileged CLI or real-host adapter.

The host is a trusted implementation, not a caller-supplied authorization.
Its mutation methods must raise PublicationUncertain for any ambiguous effect;
ordinary errors may trigger compensation only for this attempt's known objects.
Fixture success does not establish account isolation, encryption or peer auth.
"""

USER = ROLE = 'travelos_backup'
RULES = ('local replication travelos_backup peer\n'
         'local postgres travelos_backup peer\n')


class PublicationUncertain(Exception):
    def __init__(self, *_ignored):
        super().__init__('STAGE10_BACKUP_IDENTITY_RECONCILIATION_REQUIRED')


def _result(state):
    return {'state': state}


def _uncertain(host):
    try:
        host.write_journal('reconciliation_required')
    except (OSError, ValueError, PublicationUncertain):
        pass
    return _result('RECONCILIATION_REQUIRED')


def check(host):
    """Read-only verification; the real adapter must prove identity, not names."""
    try:
        valid = (host.read_journal() == 'complete'
                 and host.user_exists(USER) and host.role_exists(ROLE)
                 and host.read_hba().startswith(RULES)
                 and host.verify_role(ROLE) and host.verify_peer(USER, ROLE))
        return _result('VERIFIED' if valid else 'REJECTED')
    except (OSError, ValueError, PublicationUncertain):
        return _result('REJECTED')


def provision(host):
    """Snapshot first, then durable intent, known effects and checked completion."""
    try:
        if host.user_exists(USER) or host.role_exists(ROLE) or host.read_journal() is not None:
            return _result('REJECTED')
        original = host.read_hba()
        if type(original) is not str or USER in original:
            return _result('REJECTED')
        host.encrypt_snapshot(original)
    except PublicationUncertain:
        return _uncertain(host)
    except (OSError, ValueError):
        return _result('REJECTED')

    user_created = role_created = hba_attempted = False
    try:
        host.write_journal('started')
        host.create_user(USER)
        user_created = True
        host.create_role(ROLE)
        role_created = True
        hba_attempted = True
        host.publish_hba(RULES + original)
        host.reload_hba()
        if (host.read_hba() != RULES + original
                or not host.verify_role(ROLE) or not host.verify_peer(USER, ROLE)):
            raise ValueError('STAGE10_BACKUP_IDENTITY_VERIFICATION_FAILED')
        host.write_journal('complete')
        return _result('PROVISIONED')
    except PublicationUncertain:
        return _uncertain(host)
    except (OSError, ValueError):
        pass

    try:
        if hba_attempted:
            current = host.read_hba()
            if current not in (original, RULES + original):
                return _uncertain(host)
            if current != original:
                host.restore_hba(original)
                host.reload_hba()
            if host.read_hba() != original:
                return _uncertain(host)
        if role_created:
            host.delete_role(ROLE)
        if user_created:
            host.delete_user(USER)
        if host.user_exists(USER) or host.role_exists(ROLE):
            return _uncertain(host)
        host.write_journal('rolled_back')
        return _result('ROLLED_BACK')
    except (OSError, ValueError, PublicationUncertain):
        return _uncertain(host)
