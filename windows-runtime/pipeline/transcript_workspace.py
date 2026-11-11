"""Keep generated transcripts off read-only source media folders."""
import hashlib
import os
import shutil
from pathlib import Path
from uuid import uuid4


def cache_path_for(video, language, cache_dir):
    video = Path(video).resolve()
    stat = video.stat()
    identity = f"{video}\0{stat.st_size}\0{stat.st_mtime_ns}\0{language}"
    return Path(cache_dir) / (hashlib.sha256(identity.encode("utf-8")).hexdigest() + ".json")


def prepare_transcript(video, language, work_dir, cache_dir):
    destination = Path(work_dir) / "transcript.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    cached = cache_path_for(video, language, cache_dir)
    # Read an existing legacy sidecar, but NEVER modify it. Whisper validates
    # model/version/source metadata before deciding whether it can be reused.
    for candidate in (cached, Path(video).with_suffix(".transcript.json")):
        if candidate.is_file() and candidate.resolve() != destination.resolve():
            try:
                shutil.copyfile(candidate, destination)
                break
            except OSError as error:
                print(f"Transcript cache unavailable; transcribing locally: {error}")
    return destination, cached


def save_transcript_cache(transcript, cache):
    cache = Path(cache)
    temporary = cache.with_name(cache.name + "." + uuid4().hex + ".tmp")
    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(transcript, temporary)
        os.replace(temporary, cache)
    except OSError as error:
        # A usable job transcript exists. A cache failure must not discard it.
        print(f"Transcript cache could not be saved; continuing this job: {error}")
    finally:
        temporary.unlink(missing_ok=True)
