"""Prepare architecture-native, relocatable Python and offline speech assets on macOS."""
import json
import hashlib
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
node_arch = 'arm64' if platform.machine() == 'arm64' else 'x64'
node_name = f'node-v22.23.2-darwin-{node_arch}'
node_archive = root / 'node.tar.gz'
node_url = f'https://nodejs.org/dist/v22.23.2/{node_name}.tar.gz'
urllib.request.urlretrieve(node_url, node_archive)
with urllib.request.urlopen('https://nodejs.org/dist/v22.23.2/SHASUMS256.txt') as response:
    sums = response.read().decode()
expected = next(line.split()[0] for line in sums.splitlines() if line.endswith(node_name + '.tar.gz'))
if hashlib.sha256(node_archive.read_bytes()).hexdigest() != expected:
    raise RuntimeError('Node archive checksum mismatch')
with tarfile.open(node_archive) as source:
    source.extractall(root, filter='data')
shutil.move(str(root / node_name), str(root / 'node'))
node_archive.unlink()
ffmpeg_dir = root / 'ffmpeg'
ffmpeg_dir.mkdir(exist_ok=True)
ffmpeg_prefix = Path(subprocess.check_output(['brew', '--prefix', 'ffmpeg-full'], text=True).strip())
for name in ('ffmpeg', 'ffprobe'):
    target = ffmpeg_dir / name
    shutil.copy2(ffmpeg_prefix / 'bin' / name, target)
    target.chmod(0o755)
    subprocess.run(['dylibbundler', '-od', '-b', '-x', str(target), '-d', str(ffmpeg_dir / 'lib'), '-p', '@executable_path/lib/'], check=True)
    subprocess.run(['codesign', '--force', '--sign', '-', str(target)], check=True)
for library in (ffmpeg_dir / 'lib').glob('*'):
    if library.is_file():
        subprocess.run(['codesign', '--force', '--sign', '-', str(library)], check=True)
filters = subprocess.check_output([str(ffmpeg_dir / 'ffmpeg'), '-filters'], text=True)
for required_filter in ('drawtext', 'subtitles', 'scale', 'crop'):
    if required_filter not in filters:
        raise RuntimeError('Required video filter missing: ' + required_filter)
arch = 'aarch64' if platform.machine() == 'arm64' else 'x86_64'
headers = {'User-Agent': 'Snip-AI-build'}
if os.environ.get('GITHUB_TOKEN'):
    headers['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
request = urllib.request.Request('https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest', headers=headers)
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
