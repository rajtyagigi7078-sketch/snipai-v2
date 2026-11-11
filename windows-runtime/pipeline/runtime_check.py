"""Offline executable/model checks used by the installer and generation gate."""
import argparse
import importlib
import json
import os
import platform
import struct
import subprocess
import sys
from pathlib import Path

import native_runtime
from native_runtime import configure_native_runtime


def check_runtime(root):
    root = Path(root).resolve()
    problems, checks = [], []
    if sys.platform != 'win32' or struct.calcsize('P') != 8:
        problems.append('Snip AI requires 64-bit Windows 10 or newer.')
    required = ['python/python.exe','node/node.exe','ffmpeg/ffmpeg.exe','ffmpeg/ffprobe.exe','pipeline/pipeline_runner.py','pipeline/swift-node/swift_hinglish.mjs','whisper-model/base/model.bin','whisper-model/base/config.json','whisper-model/base/tokenizer.json','whisper-model/base/vocabulary.txt']
    for relative in required:
        if not (root / relative).is_file():
            problems.append(f'Missing bundled file: {relative}')
    model = root / 'models/ishaan-g/whisper-hinglish-swift_timestamped'
    for name in ('config.json','tokenizer.json','preprocessor_config.json'):
        if not (model / name).is_file():
            problems.append(f'Missing Swift model file: {name}')
    if not list((model / 'onnx').glob('encoder_model*.onnx')) or not list((model / 'onnx').glob('decoder_model_merged*.onnx')):
        problems.append('Bundled Swift ONNX models are incomplete.')
    try:
        configure_native_runtime(root)
        # Report the actual loaded paths, rather than accidentally passing a
        # check because a Visual Studio runtime happened to be on the build PC.
        import ctypes
        loaded_msvc = []
        for library in native_runtime._libraries:
            filename = ctypes.create_unicode_buffer(32768)
            ctypes.windll.kernel32.GetModuleFileNameW(ctypes.c_void_p(library._handle), filename, len(filename))
            actual = Path(filename.value).resolve()
            if actual.parent != (root / 'python').resolve():
                raise RuntimeError(f'Microsoft runtime was loaded outside the app: {actual}')
            loaded_msvc.append(str(actual))
        for module in ('numpy','av','onnxruntime','ctranslate2','faster_whisper'):
            importlib.import_module(module)
            checks.append(module)
        from faster_whisper.vad import get_vad_model
        get_vad_model()
        checks.append('speech detector model')
    except Exception as error:
        problems.append(f'Native speech dependency: {error}')
    env = {**os.environ, 'PATH': str(root/'node')+os.pathsep+str(root/'python')+os.pathsep+os.environ.get('PATH','')}
    commands = [('FFmpeg', root/'ffmpeg/ffmpeg.exe', ['-version']), ('FFprobe', root/'ffmpeg/ffprobe.exe', ['-version']), ('Node ONNX runtime',root/'node/node.exe',['-e', "const ort=require('./node_modules/onnxruntime-node');console.log(ort.env.versions);"])]
    for label, executable, args in commands:
        try:
            result = subprocess.run([str(executable),*args], cwd=str(root/'pipeline/swift-node'), env=env, capture_output=True, text=True, encoding='utf-8',errors='replace',timeout=35,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if result.returncode:
                problems.append(f'{label} failed: {(result.stderr or result.stdout)[-800:]}')
            else:
                checks.append(label)
        except Exception as error:
            problems.append(f'{label}: {error}')
    return {'ok':not problems,'checks':checks,'problems':problems,'loaded_msvc':locals().get('loaded_msvc',[]),'platform':platform.platform()}


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--runtime', required=True)
    parser.add_argument('--output')
    args=parser.parse_args()
    report=check_runtime(args.runtime)
    if args.output:
        output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True)
        output.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print('SNIP_RUNTIME_CHECK:'+json.dumps(report))
    sys.exit(0 if report['ok'] else 1)
