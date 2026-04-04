#!/usr/bin/env python3
import paramiko, sys
from pathlib import Path

# Read server credentials from server.txt (expected KEY=VALUE lines)
p = Path('server.txt')
if not p.exists():
    print('server.txt not found')
    sys.exit(2)

data = p.read_text()
env = {}
for L in data.splitlines():
    if '=' in L:
        k, v = L.split('=', 1)
        env[k.strip()] = v.strip()

host = env.get('IPv4') or env.get('HOST')
user = env.get('USERNAME') or 'root'
password = env.get('PASSWORD')

if not host or not password:
    print('Missing host or password in server.txt')
    sys.exit(2)

# Run the full deployment in a single shell so `cd` affects subsequent commands
commands = [
    'cd ~/210 && git pull && npm install --silent && npm run build --silent 2>&1 && (pm2 restart all || pm2 start npm --name 210 -- start)'
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
print('Connecting to', host)
try:
    client.connect(host, username=user, password=password, timeout=30)
except Exception as e:
    print('SSH connect failed:', e)
    sys.exit(1)

for cmd in commands:
    print('\n==> Running:', cmd)
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=True)
    for line in iter(stdout.readline, ''):
        print(line, end='')
    rc = stdout.channel.recv_exit_status()
    if rc != 0:
        print('\nCommand failed with exit code', rc)
        client.close()
        sys.exit(rc)

client.close()
print('\nDeployment completed successfully')
sys.exit(0)
