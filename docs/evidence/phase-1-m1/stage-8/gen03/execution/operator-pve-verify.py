import datetime, hashlib, json, subprocess, sys, urllib.parse
from pathlib import Path

CA = Path('/home/hermes/.local/share/travelos/trust/pve-root-ca.pem')
BASE = 'https://pxmx2:8006/api2/json'

def request(endpoint, body=None, ticket=None):
    args = ['curl', '--silent', '--show-error', '--fail', '--connect-timeout', '10', '--max-time', '30', '--cacert', str(CA), '--connect-to', 'pxmx2:8006:192.168.1.200:8006', '--url', BASE + endpoint]
    if body is not None:
        args += ['--data-binary', '@-']
        data = body
    elif ticket is not None:
        args += ['--config', '-']
        data = 'header = ' + json.dumps('Cookie: PVEAuthCookie=' + ticket) + '\n'
    else:
        data = ''
    p = subprocess.run(args, input=data, text=True, capture_output=True)
    if p.returncode:
        raise RuntimeError('TLS_VERIFIED_API_REQUEST_FAILED_' + str(p.returncode))
    return json.loads(p.stdout)['data']

try:
    assert hashlib.sha256(CA.read_bytes()).hexdigest() == '90d99ec1198d9730bb44fa069b9cfbb7bdb60c9f0ff8783b3f07e6ae5b281efa'
    raw = subprocess.run(['systemd-creds', '--user', 'decrypt', '/home/hermes/.hermes/secrets/proxmox-pxmx2-hermes.pvecred', '-'], text=True, capture_output=True, check=True).stdout.strip()
    user = 'hermes@pve'
    auth = request('/access/ticket', body=urllib.parse.urlencode({'username': user, 'password': raw}))
    raw = user = None
    config = request('/nodes/pxmx2/lxc/200/config', ticket=auth['ticket'])
    status = request('/nodes/pxmx2/lxc/200/status/current', ticket=auth['ticket'])
    resources = request('/cluster/resources?type=vm', ticket=auth['ticket'])
    resource = next(r for r in resources if r.get('vmid') == 200 and r.get('type') == 'lxc')
    assert config['hostname'] == 'travelos-dev'
    assert 'BC:24:11:E9:85:A9' in config['net0'].upper()
    assert status['status'] == 'running' and resource['node'] == 'pxmx2'
    ssh = subprocess.run(['ssh', '-o', 'BatchMode=yes', 'travelos-dev', 'hostname; ip -brief link'], text=True, capture_output=True, check=True).stdout
    assert 'travelos-dev' in ssh and 'bc:24:11:e9:85:a9' in ssh
    print(json.dumps({'result': 'PASS', 'observedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'target': {'node': 'pxmx2', 'ctid': 200, 'hostname': config['hostname'], 'type': 'lxc', 'status': status['status'], 'net0': config['net0']}, 'sshMacCorrelation': True, 'tlsPeerAndHostnameVerified': True, 'tlsBypassUsed': False, 'credentialValuesExposed': False, 'ticketPersisted': False, 'stage9Actions': 0}, indent=2))
except Exception as exc:
    print(json.dumps({'result': 'FAIL', 'errorType': type(exc).__name__, 'credentialValuesExposed': False}), file=sys.stderr)
    sys.exit(1)
