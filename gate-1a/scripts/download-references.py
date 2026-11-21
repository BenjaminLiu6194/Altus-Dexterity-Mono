"""Download only source photos used by the current pack into ignored .cache."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import sys

gate = Path(__file__).resolve().parents[1]
cache = gate / '.cache' / 'references'
manifest = gate / 'web' / 'reference-packs' / 'workshop' / 'sources.json'


def download(source):
    name = source['file']
    if Path(name).name != name:
        raise ValueError('Invalid reference filename')
    destination = cache / name
    if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() == source['sha256']:
        print(f'Cached: {name}', flush=True)
        return
    temporary = destination.with_suffix(destination.suffix + '.part')
    subprocess.run([
        'curl', '--fail', '--silent', '--show-error', '--location', '--max-time', '60',
        source['url'], '--output', str(temporary)
    ], check=True)
    if hashlib.sha256(temporary.read_bytes()).hexdigest() != source['sha256']:
        temporary.unlink()
        raise ValueError(f'Source changed: {name}; review it before changing the manifest')
    temporary.replace(destination)
    print(f'Downloaded: {name}', flush=True)


if __name__ == '__main__':
    cache.mkdir(parents=True, exist_ok=True)
    sources = json.loads(manifest.read_text())['images']
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(download, sources))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
