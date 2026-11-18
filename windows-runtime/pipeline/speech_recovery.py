"""Recover isolated Swift worker failures without restarting clip generation."""
import json
import os
from pathlib import Path
import subprocess
import sys


def run_logged(command, env):
    worker = subprocess.Popen(
        command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace", env=env,
        bufsize=1, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    try:
        for line in worker.stdout:
            print(line, end="", flush=True)
        return worker.wait()
    finally:
        if worker.poll() is None:
            worker.kill()
            worker.wait()
        if worker.stdout:
            worker.stdout.close()


def run_swift_with_recovery(command, env, runner=run_logged):
    for profile in ("normal", "conservative"):
        worker_env = dict(env)
        worker_env["SNIP_AI_SWIFT_SAFE_MODE"] = "1" if profile == "conservative" else "0"
        if profile == "conservative":
            worker_env.update(SNIP_AI_SWIFT_DEVICE="cpu", OMP_NUM_THREADS="1", MKL_NUM_THREADS="1")
            print("Speech recovery: retrying Swift on conservative CPU settings...", flush=True)
        code = runner(command, worker_env)
        if code == 0:
            return profile
        print(f"Swift {profile} worker failed: {code} (0x{code & 0xffffffff:08X}).", flush=True)
    return None


def offline_whisper_fallback(video, language, output, requested_version, env, runner=run_logged):
    root = Path(env.get("SNIP_AI_RUNTIME_ROOT") or Path(__file__).resolve().parent.parent)
    model_root = Path(env.get("SNIP_AI_WHISPER_MODEL_DIR") or root / "whisper-model")
    model_name = env.get("SNIP_AI_WHISPER_MODEL", "base")
    if not (model_root / model_name / "model.bin").is_file():
        raise RuntimeError("Swift recovery failed and the bundled Whisper model is missing. Reinstall Snip AI.")
    print("Speech recovery: Swift could not start; using bundled Whisper CPU (offline)...", flush=True)
    fallback_env = dict(env)
    fallback_env.update(
        SNIP_AI_HINGLISH_ENGINE="faster-whisper", SNIP_AI_WHISPER_DEVICE="cpu",
        SNIP_AI_WHISPER_MODEL_DIR=str(model_root), SNIP_AI_TRANSCRIPT_PATH=str(output),
        SNIP_AI_WHISPER_CPU_THREADS="2", SNIP_AI_WHISPER_BEAM_SIZE="1",
        SNIP_AI_RECOVERY_AUTO_LANGUAGE="1", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
    )
    code = runner([sys.executable, str(Path(__file__).with_name("whisper_transcribe.py")), str(video), language], fallback_env)
    if code != 0:
        raise RuntimeError(f"Both speech engines failed. Whisper fallback exited with {code} (0x{code & 0xffffffff:08X}). See the preceding engine log.")
    with open(output, encoding="utf-8") as file:
        data = json.load(file)
    words = [word for segment in data.get("segments", []) for word in segment.get("words", [])]
    if not words or any(not (isinstance(w.get("start"), (int, float)) and isinstance(w.get("end"), (int, float)) and 0 <= w["start"] < w["end"]) for w in words):
        raise RuntimeError("Whisper recovery did not produce valid word timestamps.")
    data["actual_engine"] = "faster-whisper-cpu-recovery"
    data["actual_whisper_version"] = data.get("whisper_version")
    data["whisper_version"] = requested_version
    data["recovery_reason"] = "swift_worker_failed_twice"
    # The normal cache identity remains intact; future jobs can reuse this result.
    temporary = Path(str(output) + ".recovery.tmp")
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, output)
    print(f"Speech recovery complete: {len(words)} timestamped words.", flush=True)
