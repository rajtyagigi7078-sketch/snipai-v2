"""Prepare architecture-native, relocatable Python and offline speech assets on macOS."""
import json
import os
import platform
import shutil
import subprocess
import tarfile
import urllib.request
from pathlib import Path

project = Path(__file__).resolve().parents[1]
root = project / '.build/macos-runtime'
if platform.system() != 'Darwin':
    raise SystemExit('Run this preparation script on a macOS runner.')
root.mkdir(parents=True, exist_ok=True)
arch = 'aarch64' if platform.machine() == 'arm64' else 'x86_64'
request = urllib.request.Request('https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest', headers={'User-Agent': 'Snip-AI-build'})
with urllib.request.urlopen(request) as response:
    release = json.load(response)
asset = next(a for a in release['assets'] if a['name'].startswith('cpython-3.11.') and f'{arch}-apple-darwin-install_only.tar.gz' in a['name'])
archive = root / 'python.tar.gz'
urllib.request.urlretrieve(asset['browser_download_url'], archive)
with tarfile.open(archive) as source:
    source.extractall(root, filter='data')
archive.unlink()
python = root / 'python/bin/python3'
subprocess.run([str(python), '-m', 'pip', 'install', 'numpy', 'av', 'onnxruntime', 'ctranslate2', 'faster-whisper', 'yt-dlp', 'yt-dlp-ejs', 'huggingface-hub'], check=True)
shutil.copytree(project / 'windows-runtime/pipeline', root / 'pipeline', dirs_exist_ok=True, ignore=shutil.ignore_patterns('node_modules', '__pycache__', '*.pyc'))
subprocess.run(['npm', 'ci', '--omit=dev'], cwd=root / 'pipeline/swift-node', check=True)
subprocess.run([str(python), '-c', "from huggingface_hub import snapshot_download; import sys; from pathlib import Path; r=Path(sys.argv[1]); snapshot_download('Systran/faster-whisper-base', local_dir=r/'whisper-model/base'); snapshot_download('ishaan-g/whisper-hinglish-swift_timestamped', local_dir=r/'models/ishaan-g/whisper-hinglish-swift_timestamped')", str(root)], check=True)
print('Prepared native Python and offline speech assets:', root)
