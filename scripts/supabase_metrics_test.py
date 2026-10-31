import json
from pathlib import Path
import tempfile
import datetime
import io
from contextlib import redirect_stdout, redirect_stderr
import unittest
from unittest.mock import patch
from supabase_metrics import parse_metrics, summarize, Store, load_key, main, scrape, NoRedirect

def raw(reads=100, writes=40, byte_count=1024, wait=1, idle=99):
    return '\n'.join([
        'node_disk_info{device="disk0",serial="secret-ignore"} 1',
        f'node_disk_reads_completed_total{{device="disk0"}} {reads}',
        f'node_disk_writes_completed_total{{device="disk0"}} {writes}',
        f'node_disk_read_bytes_total{{device="disk0"}} {byte_count}',
        'node_disk_reads_completed_total{device="disk0p1"} 99999',
        f'node_cpu_seconds_total{{cpu="0",mode="iowait"}} {wait}',
        f'node_cpu_seconds_total{{cpu="0",mode="idle"}} {idle}',
        'node_memory_SwapTotal_bytes 1024', 'node_memory_SwapFree_bytes 512',
        'node_filesystem_size_bytes{device="/dev/disk0p1",mountpoint="/data"} 100000',
        'arbitrary_sql{query="private task text"} 1'])

class MetricsTests(unittest.TestCase):
    def test_rates_units_and_no_partition_double_count(self):
        previous = parse_metrics(raw())
        current = parse_metrics(raw(220, 100, 122880 + 1024, 7, 153))
        summary = summarize(current, previous, 60)
        self.assertEqual(summary['disks']['disk0']['read_iops'], 2)
        self.assertEqual(summary['disks']['disk0']['write_iops'], 1)
        self.assertEqual(summary['disks']['disk0']['read_bytes_per_second'], 2048)
        self.assertEqual(summary['cpu_iowait_percent'], 10)
        self.assertEqual(summary['disks']['disk0']['mountpoints'], ['/data'])
        self.assertEqual(summary['swap_used_bytes'], 512)
        self.assertEqual(list(summary['disks']), ['disk0'])
        self.assertIsNone(summary['burst_budget_balance_percent'])
        self.assertNotIn('secret-ignore', json.dumps(current))
        self.assertNotIn('private task text', json.dumps(current))
    def test_first_missing_reset_and_elapsed_gap(self):
        rows = parse_metrics(raw())
        self.assertIsNone(summarize(rows)['disks']['disk0']['read_iops'])
        reset = summarize(parse_metrics(raw(1)), rows, 60)
        self.assertIsNone(reset['disks']['disk0']['read_iops'])
        self.assertIn('node_disk_reads_completed_total', reset['counter_resets'])
        self.assertEqual(summarize(parse_metrics(raw(220)), rows, 120)['disks']['disk0']['read_iops'], 1)
        self.assertIsNone(summarize([])['cpu_iowait_percent'])
    def test_no_disk_device_mapping_is_unknown(self):
        summary = summarize(parse_metrics('node_disk_reads_completed_total{device="partition"} 123'))
        self.assertFalse(summary['physical_device_mapping_available'])
        self.assertEqual(summary['disks'], {})
    def test_private_bounded_storage_and_failure_not_zero(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            sample = {'observed_at': '2026-10-30T00:00:00Z', 'scrape_ok': False, 'metrics': None}
            store.write(sample)
            self.assertIsNone(json.loads((Path(directory)/'host-latest.json').read_text())['metrics'])
            self.assertEqual((Path(directory)/'host-latest.json').stat().st_mode & 0o777, 0o600)
            store.close()
    def test_public_credential_rejected_and_env_values_not_copied(self):
        with patch.dict('os.environ', {'SUPABASE_SECRET_KEY':'sb_publishable_synthetic'}, clear=True):
            with self.assertRaisesRegex(ValueError, 'public key'):
                load_key()

    def test_missing_or_reset_cpu_iowait_is_unknown_not_measured_zero(self):
        previous = parse_metrics(raw())
        missing = parse_metrics('\n'.join(line for line in raw(220,100,2048,7,153).splitlines() if 'mode="iowait"' not in line))
        self.assertIsNone(summarize(missing, previous, 60)['cpu_iowait_percent'])
        reset = parse_metrics(raw(220,100,2048,0,160))
        self.assertIsNone(summarize(reset, previous, 60)['cpu_iowait_percent'])

    def test_missing_other_cpu_mode_is_unknown_instead_of_a_false_percentage(self):
        previous = parse_metrics(raw())
        missing = parse_metrics('\n'.join(line for line in raw(220,100,2048,7,153).splitlines() if 'mode="idle"' not in line))
        self.assertIsNone(summarize(missing, previous, 60)['cpu_iowait_percent'])

    def test_similar_whole_disk_name_is_not_misidentified_as_a_partition(self):
        metrics=parse_metrics('\n'.join([
            'node_disk_info{device="disk0"} 1',
            'node_filesystem_size_bytes{device="/dev/disk0p1",mountpoint="/data"} 1024',
            'node_filesystem_size_bytes{device="/dev/disk01",mountpoint="/other-disk"} 1024']))
        self.assertEqual(summarize(metrics)['disks']['disk0']['mountpoints'], ['/data'])

    def test_nonfinite_interval_cannot_start_a_tight_scrape_loop(self):
        for interval in ['nan','inf','-inf']:
            with self.subTest(interval=interval), tempfile.TemporaryDirectory() as directory:
                arguments=['supabase_metrics.py','--project-ref','a'*20,'--output-dir',directory,'--samples','2','--interval='+interval]
                with patch('sys.argv',arguments), patch('supabase_metrics.load_key',return_value='sb_secret_SYNTHETIC'), patch('supabase_metrics.scrape',return_value=parse_metrics(raw())) as fetch, patch('supabase_metrics.time.sleep'), redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit): main()
                    fetch.assert_not_called()

    def test_store_survives_reopen_and_prunes_age_even_at_slower_sampling(self):
        with tempfile.TemporaryDirectory() as directory:
            now=datetime.datetime.now(datetime.timezone.utc)
            sample={'observed_at':now.isoformat(),'scrape_ok':True,'metrics':{'disks':{}}}
            store=Store(directory)
            old=(now-datetime.timedelta(days=9)).isoformat()
            with store.db: store.db.execute('INSERT INTO samples(observed_at,summary) VALUES(?,?)',(old,json.dumps({'observed_at':old})))
            store.close()
            store=Store(directory)
            try:
                store.write(sample)
                self.assertEqual(store.db.execute('SELECT count(*) FROM samples').fetchone()[0],1)
                self.assertEqual((Path(directory)/'metrics.sqlite').stat().st_mode&0o777,0o600)
                self.assertEqual(json.loads((Path(directory)/'host-latest.json').read_text())['observed_at'],sample['observed_at'])
            finally: store.close()

    def test_scrape_is_bounded_authenticated_and_does_not_follow_redirects(self):
        with patch('supabase_metrics.urllib.request.build_opener') as factory:
            response=factory.return_value.open.return_value.__enter__.return_value
            response.read.return_value=raw().encode()
            self.assertTrue(scrape('a'*20,'sb_secret_SYNTHETIC'))
            request=factory.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url,'https://'+'a'*20+'.supabase.co/customer/v1/privileged/metrics')
            self.assertEqual(factory.return_value.open.call_args.kwargs['timeout'],15)
            response.read.assert_called_once_with(5_000_001)
            self.assertIsNone(NoRedirect().redirect_request(request,None,302,'redirect',{},'https://untrusted.invalid/'))
            response.read.return_value=b'x'*5_000_001
            with self.assertRaisesRegex(ValueError,'exceeds limit'): scrape('a'*20,'sb_secret_SYNTHETIC')

    def test_failure_history_retains_last_good_time_and_does_not_disclose_exception_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            base=datetime.datetime.now(datetime.timezone.utc)
            stamps=[(base+datetime.timedelta(seconds=n)).isoformat() for n in [0,60,120]]
            arguments=['supabase_metrics.py','--project-ref','a'*20,'--output-dir',directory,'--samples','3']
            output=io.StringIO()
            with patch('sys.argv',arguments), patch('supabase_metrics.load_key',return_value='sb_secret_SYNTHETIC'), patch('supabase_metrics.scrape',side_effect=[parse_metrics(raw()),ValueError('sb_secret_DO_NOT_EXPORT private-body'),parse_metrics(raw(220))]), patch('supabase_metrics.utc_now',side_effect=stamps), patch('supabase_metrics.time.monotonic',side_effect=[0,1,2,60,62,120,121]), patch('supabase_metrics.time.sleep'), redirect_stdout(output), redirect_stderr(output):
                main()
            store=Store(directory)
            try:
                entries=[json.loads(row[0]) for row in store.db.execute('SELECT summary FROM samples ORDER BY id')]
                self.assertEqual(len(entries),3)
                self.assertFalse(entries[1]['scrape_ok'])
                self.assertEqual(entries[1]['last_good_at'],stamps[0])
                self.assertIsNone(entries[1]['metrics'])
                self.assertEqual(entries[2]['metrics']['disks']['disk0']['read_iops'],1)
                self.assertNotIn('sb_secret_',json.dumps(entries)+output.getvalue())
                self.assertNotIn('private-body',json.dumps(entries)+output.getvalue())
            finally: store.close()

if __name__ == '__main__':
    unittest.main()
