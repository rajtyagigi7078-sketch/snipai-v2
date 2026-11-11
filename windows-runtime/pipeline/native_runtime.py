"""Resolve native runtimes from the application before loading speech packages."""
import ctypes
import os
import sys
from pathlib import Path

_directory_handles = []
_libraries = []


def configure_native_runtime(root=None):
    root = Path(root or os.environ.get('SNIP_AI_RUNTIME_ROOT') or Path(__file__).resolve().parent.parent).resolve()
    if sys.platform != 'win32':
        return root
    python = root / 'python'
    for directory in (python, root / 'node', python / 'Lib/site-packages/ctranslate2', python / 'Lib/site-packages/onnxruntime/capi', python / 'Lib/site-packages/numpy.libs', python / 'Lib/site-packages/av.libs'):
        if directory.is_dir():
            _directory_handles.append(os.add_dll_directory(str(directory)))
    for name in ('vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'):
        target = python / name
        if not target.is_file():
            raise RuntimeError(f'RUNTIME_DEPENDENCY: Bundled {name} is missing. Reinstall Snip AI or use Repair runtime.')
        try:
            _libraries.append(ctypes.WinDLL(str(target)))
        except OSError as error:
            raise RuntimeError(f'RUNTIME_DEPENDENCY: Could not load bundled {name}. Use Repair runtime. {error}') from error
    return root
