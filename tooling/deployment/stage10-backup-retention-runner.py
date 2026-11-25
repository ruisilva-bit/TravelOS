"""Fixed seven-day DEVELOPMENT backup sweep; no historical backup roots."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import time

_spec = importlib.util.spec_from_file_location('retention_expiry', Path(__file__).with_name('stage10-backup-expiry.py'))
assert _spec and _spec.loader
expiry = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(expiry)
STORE = Path('/home/hermes/.local/share/travelos-stage10-backups')


def _sweep(store, now):
    """Trusted implementation seam for disposable fixtures, not CLI options.

    Same-UID writers are trusted. A partial deletion stops future sweeps through
    the existing quarantine/reconciliation mechanism. Validate the whole batch
    before the first expiry; never automatically repair an unknown entry.
    """
    expiry._require(type(now) is int and 0 <= now <= 253402300799)
    parent = expiry._native._private_parent(store)
    try:
        names = expiry._names(parent, 512)
        expiry._require('manager.json' in names)
        ids = sorted(n for n in names if n != 'manager.json')
        expiry._require(all(expiry.IDENTIFIER.fullmatch(n) for n in ids))
        # Empty stores still require an exact owned policy.
        policy = json.loads(expiry._read(parent, 'manager.json', 16384), object_pairs_hook=expiry._pairs)
        expected = {'schemaVersion': 1, 'manager': expiry.MANAGER, 'environment': 'DEVELOPMENT', 'retentionSeconds': expiry.WEEK}
        expiry._require(type(policy) is dict and set(policy) == set(expected)
                        and all(type(policy[k]) is type(v) and policy[k] == v for k, v in expected.items()))
        for name in ids:
            directory = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            try:
                metadata = json.loads(expiry._read(directory, 'backup.json', 16384), object_pairs_hook=expiry._pairs)
                created = metadata['createdAt']
                expiry._require(type(created) is int and 0 <= created <= now)
            finally:
                os.close(directory)
            expiry._require(expiry.expire_backup(store, name, now=created)['state'] == 'NOT_DUE')
    finally:
        os.close(parent)
    results = [expiry.expire_backup(store, name, now=now) for name in ids]
    return {'state': 'RETENTION_SWEEP_COMPLETE', 'checked': len(results),
            'expired': sum(r['state'] == 'EXPIRED' for r in results)}


def main():
    try:
        expiry._require(sys.argv[1:] == ['--run'] and os.getuid() == 1000 and os.geteuid() == 1000)
        result = _sweep(STORE, int(time.time()))
    except (OSError, ValueError, KeyError, TypeError):
        print(json.dumps({'state': 'RETENTION_STOPPED_RECONCILIATION_REQUIRED'}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
