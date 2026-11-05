#!/usr/bin/env python3
"""Detect and persist local Snip AI hardware capabilities."""

import json
import os
import tempfile
from pathlib import Path


PROFILE_VERSION = 3


def profile_path():
    """Return a per-user config path shared by clipping and auto-caption."""
    if os.name == "nt":
        root = os.environ.get("LOCALAPPDATA")
        base = Path(root) if root else Path.home() / "AppData" / "Local"
    else:
        root = os.environ.get("XDG_CONFIG_HOME")
        base = Path(root) if root else Path.home() / ".config"
    return base / "Snip AI" / "hardware-profile.json"


def read_profile():
    try:
        data = json.loads(profile_path().read_text(encoding="utf-8"))
        if data.get("version") == PROFILE_VERSION:
            return data
    except (OSError, ValueError, TypeError):
        pass
    return None


def _save_profile(data):
    path = profile_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix="hardware-profile-", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(data, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, path)
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


def get_or_detect(python, ffmpeg, force_detect=False):
    """Persist the supported CPU-only configuration without loading GPU providers."""
    profile = {
        "version": PROFILE_VERSION,
        "transcription": {
            "device": "cpu",
            "faster_whisper_device": "cpu",
            "swift_device": "cpu",
        },
        "video": {"mode": "software", "encoder": "libx264"},
    }
    try:
        if force_detect or read_profile() != profile:
            _save_profile(profile)
        saved = f"saved to {profile_path()}"
    except OSError as error:
        saved = f"could not save ({error}); this run will still use CPU"
    print(
        "CPU runtime selected: transcription=English CPU, Hinglish CPU, "
        f"video=libx264 (software); profile {saved}.",
        flush=True,
    )
    return profile


def main():
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Detect and persist Snip AI hardware support.")
    parser.add_argument("--force", action="store_true", help="Ignore and replace the saved hardware profile.")
    args = parser.parse_args()
    python = os.environ.get("SNIP_AI_PYTHON", sys.executable)
    ffmpeg = os.environ.get("SNIP_AI_FFMPEG", "")
    if not ffmpeg:
        raise RuntimeError("SNIP_AI_FFMPEG must point to Snip AI's bundled FFmpeg executable.")
    profile = get_or_detect(python, ffmpeg, force_detect=args.force)
    print("SNIP_AI_HARDWARE_PROFILE=" + json.dumps(profile, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
