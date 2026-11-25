"""Local-only operational probe prototype; NOT a privileged entry point.

Not wired to the host operator or sudo. In particular, activation remains exclusively
behind the existing native entry and signature guard. This module cannot perform it.
"""
import http.client
import json
import os
import subprocess
import sys

SYSTEMCTL = '/usr/bin/systemctl'
UNITS = ('travelos-admin-api.service', 'travelos-portal-api.service', 'travelos-worker.service')
HEALTH_PORTS = (3101, 3102)


def emit(result):
    print(json.dumps({'result': result}, sort_keys=True))


def dispatch(args):
    if len(args) != 1 or args[0] not in ('status', 'service-report', 'health', 'diagnostic', 'backup'):
        emit('REJECTED')
        return 1
    action = args[0]
    if action == 'backup':
        emit('BACKUP_NOT_IMPLEMENTED')
        return 1
    if action == 'diagnostic':
        # Do not dump process environment, journal, service config, or credentials.
        try:
            usage = os.statvfs('/')
            print(json.dumps({'result': 'DIAGNOSTIC', 'rootAvailableBytes': usage.f_bavail * usage.f_frsize}, sort_keys=True))
        except OSError:
            emit('UNAVAILABLE')
            return 1
        return 0
    if action == 'service-report':
        services = {}
        for unit in UNITS:
            try:
                result = subprocess.run([SYSTEMCTL, 'is-active', '--quiet', unit],
                                        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL, timeout=3, check=False,
                                        env={'PATH': '/usr/bin:/bin', 'LANG': 'C'}, cwd='/')
                services[unit] = 'ACTIVE' if result.returncode == 0 else 'UNAVAILABLE'
            except (OSError, subprocess.TimeoutExpired):
                services[unit] = 'UNAVAILABLE'
        active = all(state == 'ACTIVE' for state in services.values())
        print(json.dumps({'result': 'ACTIVE' if active else 'UNAVAILABLE', 'services': services}, sort_keys=True))
        return 0 if active else 1
    if action == 'status':
        try:
            for unit in UNITS:
                result = subprocess.run([SYSTEMCTL, 'is-active', '--quiet', unit],
                                        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL, timeout=3, check=False,
                                        env={'PATH': '/usr/bin:/bin', 'LANG': 'C'}, cwd='/')
                if result.returncode != 0:
                    emit('UNAVAILABLE')
                    return 1
        except (OSError, subprocess.TimeoutExpired):
            emit('UNAVAILABLE')
            return 1
        emit('ACTIVE')
        return 0
    for port in HEALTH_PORTS:
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
        try:
            connection.request('GET', '/health/live')
            response = connection.getresponse()
            if response.status != 200:
                emit('UNHEALTHY')
                return 1
        except (OSError, http.client.HTTPException):
            emit('UNHEALTHY')
            return 1
        finally:
            connection.close()
    emit('HEALTHY')
    return 0


if __name__ == '__main__':
    # Never use this file as a sudo target or privileged host dispatcher.
    if os.geteuid() == 0:
        emit('REJECTED')
        raise SystemExit(1)
    raise SystemExit(dispatch(sys.argv[1:]))
