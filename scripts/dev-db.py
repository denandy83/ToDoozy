"""Create consistent, read-only-source SQLite snapshots for development."""
import argparse
import datetime
import os
from pathlib import Path
import sqlite3
import sys


def select_source(data_dir, explicit=None):
    if explicit:
        source = Path(explicit).expanduser().resolve()
        if not source.is_file():
            raise ValueError(f"Database does not exist: {source}")
        return source
    candidates = [p for p in data_dir.glob('todoozy-*.db')
                  if '.backup' not in p.name and p.stat().st_size > 0]
    if not candidates:
        legacy = data_dir / 'todoozy.db'
        if legacy.is_file() and legacy.stat().st_size > 0:
            return legacy
        raise ValueError('No populated database found; pass --source /path/to/account.db')
    def modified(path):
        wal = Path(str(path) + '-wal')
        return max(path.stat().st_mtime, wal.stat().st_mtime if wal.exists() else 0)
    return max(candidates, key=modified)


def copies(directory, kind):
    return sorted(directory.glob(f'{kind}-*.db'), reverse=True)


def cleanup(directory, kind):
    for old in copies(directory, kind)[5:]:
        for path in (old, Path(str(old) + '-wal'), Path(str(old) + '-shm')):
            path.unlink(missing_ok=True)
        print(f'Removed old dev DB: {old.name}', file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['create', 'path', 'cleanup', 'list'])
    parser.add_argument('kind', nargs='?', choices=['feature', 'bugfix'])
    parser.add_argument('--source', help='Explicit SQLite source (opened read-only)')
    args = parser.parse_args()
    if args.command != 'list' and not args.kind:
        parser.error('kind is required: feature or bugfix')
    data_dir = Path(os.environ.get('TODOOZY_DATA_DIR', str(Path.home() / 'Library/Application Support/todoozy')))
    directory = data_dir / 'dev-dbs'
    directory.mkdir(parents=True, exist_ok=True)
    if args.command == 'create':
        source = select_source(data_dir, args.source)
        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        target = directory / f'{args.kind}-{stamp}.db'
        # Backup includes WAL pages without checkpointing the production source.
        with sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True) as src:
            if not src.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks'").fetchone():
                raise ValueError(f'Source has no tasks table: {source}')
            with sqlite3.connect(target) as dst:
                src.backup(dst)
        cleanup(directory, args.kind)
        print(f'Copied {source}', file=sys.stderr)
        print(target)  # stdout contains ONLY the path for command substitution
    elif args.command == 'path':
        found = copies(directory, args.kind)
        if not found:
            raise ValueError(f'No dev database for {args.kind}')
        print(found[0])
    elif args.command == 'cleanup':
        cleanup(directory, args.kind)
    else:
        for kind in ('feature', 'bugfix'):
            for path in copies(directory, kind):
                print(path)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, sqlite3.Error, OSError) as error:
        print(f'dev-db: {error}', file=sys.stderr)
        sys.exit(1)
