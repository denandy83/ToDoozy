"""Private, bounded Supabase host metrics collector. Credentials never reach output.

python3 scripts/supabase_metrics.py --project-ref REF --output-dir PRIVATE_DIR --env-file SERVER_ENV
One shared collector per project; the default sampling interval is 60 seconds.
"""
import argparse
import base64
import datetime
import fcntl
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request

COUNTERS = {
    'node_disk_reads_completed_total', 'node_disk_writes_completed_total',
    'node_disk_read_bytes_total', 'node_disk_written_bytes_total', 'node_disk_io_time_seconds_total',
    'node_cpu_seconds_total', 'node_vmstat_pswpin', 'node_vmstat_pswpout',
}
GAUGES = {'node_memory_MemTotal_bytes', 'node_memory_MemAvailable_bytes',
          'node_memory_SwapTotal_bytes', 'node_memory_SwapFree_bytes'}
INFO = {'node_disk_info', 'node_filesystem_size_bytes'}

def parse_metrics(text):
    """Select known numeric series only; drop arbitrary SQL/identity labels."""
    result = []
    for line in text.splitlines():
        match = re.fullmatch(r'([a-zA-Z_:][a-zA-Z_0-9:]*)(\{.*\})?\s+([^\s]+)(?:\s+\d+)?', line)
        if not match or match[1] not in COUNTERS | GAUGES | INFO:
            continue
        try:
            value = float(match[3])
        except ValueError:
            continue
        if not math.isfinite(value) or value < 0:
            continue
        labels = {}
        for key, encoded in re.findall(r'(\w+)="((?:\\.|[^"\\])*)"', match[2] or ''):
            if key in {'device', 'cpu', 'mode', 'mountpoint'}:
                labels[key] = json.loads('"' + encoded + '"')
        result.append({'name': match[1], 'labels': labels, 'value': value})
    return result

def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def summarize(current, previous=None, elapsed=None):
    def key(row):
        return row['name'], tuple(sorted(row['labels'].items()))
    old = {key(r): r['value'] for r in previous or []}
    resets = []
    def rate(row):
        before = old.get(key(row))
        if before is None or not elapsed or elapsed <= 0:
            return None
        if row['value'] < before:
            resets.append(row['name'])
            return None
        return (row['value'] - before) / elapsed
    gauges = {r['name']: r['value'] for r in current if r['name'] in GAUGES}
    # node_disk_info identifies whole disks. Do not add partition counters again.
    physical = {r['labels'].get('device') for r in current if r['name'] == 'node_disk_info'} - {None}
    disks = {}
    fields = {'node_disk_reads_completed_total': 'read_iops', 'node_disk_writes_completed_total': 'write_iops',
              'node_disk_read_bytes_total': 'read_bytes_per_second', 'node_disk_written_bytes_total': 'write_bytes_per_second',
              'node_disk_io_time_seconds_total': 'busy_fraction'}
    for device in sorted(physical):
        disks[device] = {field: None for field in fields.values()}
        disks[device]['mountpoints'] = sorted({r['labels']['mountpoint'] for r in current
            if r['name'] == 'node_filesystem_size_bytes' and 'mountpoint' in r['labels']
            and re.fullmatch(re.escape('/dev/' + device) + (r'(?:p\d+)?' if device[-1].isdigit() else r'(?:\d+)?'), r['labels'].get('device', ''))})
    io_wait = cpu_total = 0.0
    cpu_seen = False
    current_cpu_keys = {key(r) for r in current if r['name'] == 'node_cpu_seconds_total'}
    previous_cpu_keys = {key(r) for r in previous or [] if r['name'] == 'node_cpu_seconds_total'}
    cpu_complete = current_cpu_keys == previous_cpu_keys
    idle_cpus = {r['labels'].get('cpu') for r in current
                 if r['name'] == 'node_cpu_seconds_total' and r['labels'].get('mode') == 'idle'}
    iowait_cpus = set()
    all_cpus = set()
    swapping = {}
    for row in current:
        name, device = row['name'], row['labels'].get('device')
        if name in fields and device in disks:
            disks[device][fields[name]] = rate(row)
        elif name == 'node_cpu_seconds_total':
            all_cpus.add(row['labels'].get('cpu'))
            value = rate(row)
            if value is None:
                cpu_complete = False
            if row['labels'].get('mode') == 'iowait' and value is not None:
                iowait_cpus.add(row['labels'].get('cpu'))
            if value is not None:
                cpu_seen = True
                cpu_total += value
                if row['labels'].get('mode') == 'iowait':
                    io_wait += value
        elif name in {'node_vmstat_pswpin', 'node_vmstat_pswpout'}:
            swapping['in_pages_per_second' if name.endswith('pswpin') else 'out_pages_per_second'] = rate(row)
    total = gauges.get('node_memory_MemTotal_bytes')
    available = gauges.get('node_memory_MemAvailable_bytes')
    swap_total, swap_free = gauges.get('node_memory_SwapTotal_bytes'), gauges.get('node_memory_SwapFree_bytes')
    return {'disks': disks, 'physical_device_mapping_available': bool(physical),
            'cpu_iowait_percent': 100 * io_wait / cpu_total if cpu_seen and cpu_complete and all_cpus == iowait_cpus == idle_cpus and cpu_total > 0 else None,
            'memory_used_bytes': total - available if total is not None and available is not None and available <= total else None,
            'swap_used_bytes': swap_total - swap_free if swap_total is not None and swap_free is not None and swap_free <= swap_total else None,
            'swap_activity': swapping, 'counter_resets': sorted(set(resets)),
            'burst_budget_balance_percent': None,
            'budget_note': 'No supported balance series established; never infer credits from IOPS or disk busy time.'}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None

def load_key(env_file=None, keychain_service=None, project_ref=None):
    values = dict(os.environ)
    if env_file:
        for line in Path(env_file).read_text().splitlines():
            if '=' not in line or line.lstrip().startswith('#'):
                continue
            name, value = line.split('=', 1)
            name, value = name.strip().removeprefix('export '), value.strip()
            if name in {'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'}:
                values[name] = value[1:-1] if len(value) >= 2 and value[0] == value[-1] and value[0] in '\"\'' else value
    if keychain_service:
        result = subprocess.run(['/usr/bin/security', 'find-generic-password', '-s', keychain_service,
                                 '-a', project_ref, '-w'], capture_output=True, text=True, check=True)
        secret = result.stdout.strip()
    else:
        secret = next((values.get(k) for k in ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'] if values.get(k)), None)
    if not secret:
        raise ValueError('Privileged Supabase metrics credential is not configured')
    if secret.startswith('sb_secret_'):
        return secret
    try:
        claims = json.loads(base64.urlsafe_b64decode(secret.split('.')[1] + '==='))
        if claims.get('role') == 'service_role':
            return secret
    except (ValueError, IndexError):
        pass
    raise ValueError('Metrics requires a secret/service-role key; a public key cannot be used')

def scrape(project_ref, secret):
    if not re.fullmatch(r'[a-z0-9]{20}', project_ref):
        raise ValueError('Invalid Supabase project reference')
    url = f'https://{project_ref}.supabase.co/customer/v1/privileged/metrics'
    auth = base64.b64encode(('service_role:' + secret).encode()).decode()
    request = urllib.request.Request(url, headers={'Authorization': 'Basic ' + auth})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
        # Bound the response as well as retries; metrics must not exhaust memory.
        raw = response.read(5_000_001)
        if len(raw) > 5_000_000:
            raise ValueError('Metrics response exceeds limit')
        return parse_metrics(raw.decode())

class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(self.directory / 'metrics.sqlite')
        os.chmod(self.directory / 'metrics.sqlite', 0o600)
        self.db.execute('CREATE TABLE IF NOT EXISTS samples(id INTEGER PRIMARY KEY, observed_at TEXT, summary TEXT)')
    def write(self, sample):
        serialized = json.dumps(sample, allow_nan=False)
        with self.db:
            self.db.execute('INSERT INTO samples(observed_at,summary) VALUES(?,?)', (sample['observed_at'], serialized))
            cutoff = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=7)).isoformat()
            self.db.execute('DELETE FROM samples WHERE observed_at < ?', (cutoff,))
            self.db.execute('DELETE FROM samples WHERE id NOT IN (SELECT id FROM samples ORDER BY id DESC LIMIT 10080)')
        target = self.directory / 'host-latest.json'
        temporary = target.with_suffix('.tmp')
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as output:
            output.write(serialized)
        os.replace(temporary, target)
    def close(self):
        self.db.close()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-ref', required=True)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--env-file')
    parser.add_argument('--keychain-service')
    parser.add_argument('--interval', type=float, default=60)
    parser.add_argument('--samples', type=int, default=0, help='0=continuous; use2+ to obtain counter rates')
    args = parser.parse_args()
    if not math.isfinite(args.interval) or args.interval < 60 or args.samples < 0:
        parser.error('Interval must be at least60 seconds and sample count nonnegative')
    # Validate credentials before creating any output/history.
    secret = load_key(args.env_file, args.keychain_service, args.project_ref)
    directory = Path(args.output_dir)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / 'collector.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        store = Store(directory)
        previous = previous_at = last_good = None
        count = 0
        try:
            while args.samples == 0 or count < args.samples:
                start = time.monotonic()
                try:
                    current = scrape(args.project_ref, secret)
                    if not current:
                        raise ValueError('No supported metrics returned')
                    now = time.monotonic()
                    sample = {'observed_at': utc_now(), 'scrape_ok': True,
                              'elapsed_seconds': now - previous_at if previous_at else None,
                              'metrics': summarize(current, previous, now - previous_at if previous_at else None)}
                    previous, previous_at, last_good = current, now, sample['observed_at']
                except Exception as error:
                    # Never print response bodies, request objects, secrets or env values.
                    sample = {'observed_at': utc_now(), 'scrape_ok': False, 'last_good_at': last_good,
                              'error_type': type(error).__name__, 'metrics': None}
                store.write(sample)
                count += 1
                if args.samples == 0 or count < args.samples:
                    time.sleep(max(0, args.interval - (time.monotonic() - start)))
        finally:
            store.close()

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        raise SystemExit(f'Collector did not start ({type(error).__name__}); check private credential/configuration.') from None
