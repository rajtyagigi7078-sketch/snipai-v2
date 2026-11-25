#!/usr/bin/env python3

from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

from hardware_profile import get_or_detect
from transcript_workspace import cache_path_for, prepare_transcript, save_transcript_cache
from clip_duration import fit_moments, requested_duration


# ============================================================
# SNIP AI â€” PORTABLE PIPELINE RUNNER V4
#
# Pipeline:
#
# Video
#   â†“
# Whisper
#   â†“
# Story Event Map V3
#   â†“
# Generation Selector
#   â†“
# Simple Renderer
#   â†“
# Final clips
#
# Supports:
#   1. Windows bundled runtime
#   2. Linux development runtime
#   3. Legacy local pipeline
# ============================================================


# ============================================================
# PROJECT / RUNTIME PATHS
# ============================================================

FFMPEG_CAPTION_TEMPLATES = {
    "pop", "karaoke", "bold-center", "punch", "minimal",
    "highlight-box", "typewriter", "bounce", "kinetic", "podcast",
    "yellow-stack", "violet-pill", "dual-line", "bold-karaoke", "soft-lyric",
    "none",
}


BASE_DIR = Path(
    os.environ.get(
        "SNIP_AI_PROJECT_ROOT",
        Path(__file__).resolve().parent,
    )
).expanduser().resolve()


RUNTIME_ROOT_ENV = os.environ.get(
    "SNIP_AI_RUNTIME_ROOT"
)


if RUNTIME_ROOT_ENV:
    RUNTIME_ROOT = (
        Path(RUNTIME_ROOT_ENV)
        .expanduser()
        .resolve()
    )
else:
    RUNTIME_ROOT = None


# ------------------------------------------------------------
# Detect bundled runtime
# ------------------------------------------------------------

BUNDLED_RUNTIME = (
    RUNTIME_ROOT is not None
    and (RUNTIME_ROOT / "pipeline").is_dir()
)


if BUNDLED_RUNTIME:

    PIPELINE_DIR = (
        RUNTIME_ROOT / "pipeline"
    )

    if os.name == "nt":
        # Windows production runtime uses the bundled Python.
        BUNDLED_PYTHON = (
            RUNTIME_ROOT
            / "python"
            / "python.exe"
        )
    else:
        # Linux development uses the exact Python environment
        # supplied by Tauri through SNIP_AI_PYTHON.
        supplied_python = os.environ.get("SNIP_AI_PYTHON")

        if supplied_python:
            BUNDLED_PYTHON = (
                Path(supplied_python)
                .expanduser()
                .resolve()
            )
        else:
            # Fallback for direct pipeline execution from the
            # Snip AI project.
            project_root = Path(__file__).resolve().parents[1]

            BUNDLED_PYTHON = (
                project_root
                / ".whisper-venv"
                / "bin"
                / "python"
            )

    BUNDLED_FFMPEG = (
        RUNTIME_ROOT
        / "ffmpeg"
        / (
            "ffmpeg.exe"
            if os.name == "nt"
            else "ffmpeg"
        )
    )

    BUNDLED_FFPROBE = (
        RUNTIME_ROOT
        / "ffmpeg"
        / (
            "ffprobe.exe"
            if os.name == "nt"
            else "ffprobe"
        )
    )

    BUNDLED_WHISPER_MODEL = (
        RUNTIME_ROOT
        / "whisper-model"
    )

else:

    PIPELINE_DIR = BASE_DIR

    BUNDLED_PYTHON = None

    BUNDLED_FFMPEG = None

    BUNDLED_FFPROBE = None

    BUNDLED_WHISPER_MODEL = None


# ============================================================
# LEGACY / DEVELOPMENT PATHS
# ============================================================

CLIPPER_DIR = (
    BASE_DIR / "clipper"
)


if os.name == "nt":
    # Windows production ALWAYS uses the bundled runtime.
    supplied_python = os.environ.get("SNIP_AI_PYTHON")
    if BUNDLED_PYTHON is not None and BUNDLED_PYTHON.is_file():
        WHISPER_PYTHON = BUNDLED_PYTHON
    elif supplied_python and Path(supplied_python).expanduser().is_file():
        WHISPER_PYTHON = Path(supplied_python).expanduser().resolve()
    else:
        WHISPER_PYTHON = Path(sys.executable)

else:
    # Linux development ALWAYS reuses the exact Python
    # interpreter that launched pipeline_runner.py.
    #
    # This is intentionally sys.executable.
    #
    # Do NOT resolve .whisper-venv/bin/python because on this
    # Linux installation it is a symlink to /usr/bin/python3.14.
    #
    # sys.executable preserves the active virtual environment
    # and therefore preserves faster-whisper and all other
    # installed packages.
    WHISPER_PYTHON = Path(sys.executable)



if BUNDLED_RUNTIME:

    WHISPER_SCRIPT = (
        PIPELINE_DIR
        / "whisper_transcribe.py"
    )

    STORY_EVENT_MAP_SCRIPT = (
        PIPELINE_DIR
        / "story_event_map.py"
    )

    GENERATION_SELECTOR_SCRIPT = (
        PIPELINE_DIR
        / "generation_selector.py"
    )

    RENDER_SCRIPT = (
        PIPELINE_DIR
        / "render_clips_simple.py"
    )

else:
    PIPELINE_DIR = Path(__file__).resolve().parent

    WHISPER_SCRIPT = PIPELINE_DIR / "whisper_transcribe.py"
    STORY_EVENT_MAP_SCRIPT = PIPELINE_DIR / "story_event_map.py"
    GENERATION_SELECTOR_SCRIPT = PIPELINE_DIR / "generation_selector.py"
    RENDER_SCRIPT = PIPELINE_DIR / "render_clips_simple.py"

# ============================================================
# FFMPEG / FFPROBE
# ============================================================

def resolve_ffmpeg():

    configured = os.environ.get(
        "SNIP_AI_FFMPEG"
    )

    if configured:
        path = Path(
            configured
        ).expanduser().resolve()

        if path.is_file():
            return path

    if (
        BUNDLED_FFMPEG is not None
        and BUNDLED_FFMPEG.is_file()
    ):
        return BUNDLED_FFMPEG

    found = shutil.which(
        "ffmpeg"
    )

    if found:
        return Path(found)

    return None


def resolve_ffprobe():

    configured = os.environ.get(
        "SNIP_AI_FFPROBE"
    )

    if configured:
        path = Path(
            configured
        ).expanduser().resolve()

        if path.is_file():
            return path

    if (
        BUNDLED_FFPROBE is not None
        and BUNDLED_FFPROBE.is_file()
    ):
        return BUNDLED_FFPROBE

    found = shutil.which(
        "ffprobe"
    )

    if found:
        return Path(found)

    return None


FFMPEG = resolve_ffmpeg()
FFPROBE = resolve_ffprobe()


# ============================================================
# USER DIRECTORIES
# ============================================================

HOME_DIR = Path.home()


DOWNLOADS_DIR = Path(
    os.environ.get(
        "SNIP_AI_DOWNLOADS_DIR",
        HOME_DIR / "Downloads",
    )
).expanduser().resolve()


OUTPUT_DIR = Path(
    os.environ.get(
        "SNIP_AI_OUTPUT_DIR",
        DOWNLOADS_DIR / "Snip AI Clips",
    )
).expanduser().resolve()


WORK_DIR = Path(
    os.environ.get(
        "SNIP_AI_WORK_DIR",
        HOME_DIR / ".snip-ai",
    )
).expanduser().resolve()


# ============================================================
# WORK FILES
# ============================================================

STORY_EVENT_MAP_FILE = (
    WORK_DIR
    / "story-event-map.json"
)


SELECTED_GENERATION_FILE = (
    WORK_DIR
    / "selected-generation.json"
)


HISTORY_FILE = (
    WORK_DIR
    / "generation-history.json"
)


# ============================================================
# SUBPROCESS ENVIRONMENT
# ============================================================

def build_process_environment():

    environment = os.environ.copy()

    path_entries = []

    # Bundled FFmpeg directory
    if FFMPEG is not None:
        path_entries.append(
            str(FFMPEG.parent)
        )

    # Bundled Python directory
    if BUNDLED_PYTHON is not None:
        path_entries.append(
            str(BUNDLED_PYTHON.parent)
        )

    existing_path = environment.get(
        "PATH",
        ""
    )

    path_entries.append(
        existing_path
    )

    environment["PATH"] = os.pathsep.join(
        path_entries
    )

    # Runtime root
    if RUNTIME_ROOT is not None:
        environment[
            "SNIP_AI_RUNTIME_ROOT"
        ] = str(RUNTIME_ROOT)

    # FFmpeg
    if FFMPEG is not None:
        environment[
            "SNIP_AI_FFMPEG"
        ] = str(FFMPEG)

    # FFprobe
    if FFPROBE is not None:
        environment[
            "SNIP_AI_FFPROBE"
        ] = str(FFPROBE)

    # Whisper model
    if BUNDLED_WHISPER_MODEL is not None:
        environment[
            "SNIP_AI_WHISPER_MODEL_DIR"
        ] = str(
            BUNDLED_WHISPER_MODEL
        )

    return environment


PROCESS_ENV = build_process_environment()


# ============================================================
# HELPERS
# ============================================================

def fail(message):

    print()
    print("=" * 72)
    print("SNIP AI PIPELINE ERROR")
    print("=" * 72)
    print(message)
    print("=" * 72)

    sys.exit(1)


def check_file(
    path,
    description,
):

    if not path.exists():

        fail(
            f"{description} not found:\n"
            f"{path}"
        )

    if not path.is_file():

        fail(
            f"{description} is not a file:\n"
            f"{path}"
        )


def run_command(
    command,
    stage,
):

    print()
    print("=" * 72)
    print(f"SNIP AI â€” {stage}")
    print("=" * 72)

    print()
    print(
        " ".join(
            str(item)
            for item in command
        )
    )

    print()

    started = time.perf_counter()

    try:

        process = subprocess.Popen(
            [
                str(item)
                for item in command
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=PROCESS_ENV,
        )

    except Exception as exc:

        fail(
            f"Could not start {stage}:\n"
            f"{exc}"
        )

    if process.stdout is not None:

        for line in process.stdout:

            print(
                line.rstrip()
            )

    return_code = process.wait()

    elapsed = (
        time.perf_counter()
        - started
    )

    print()

    print(
        f"{stage} finished in "
        f"{elapsed:.1f}s"
    )

    if return_code != 0:

        fail(
            f"{stage} failed.\n"
            f"Exit code: {return_code}"
        )


def run_command_capture(
    command,
):

    try:

        return subprocess.run(
            [
                str(item)
                for item in command
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=PROCESS_ENV,
        )

    except Exception:

        return None


# ============================================================
# VIDEO INFO
# ============================================================

def get_video_duration(
    video_path,
):

    if FFPROBE is None:

        fail(
            "ffprobe was not found.\n"
            "Expected bundled ffprobe or "
            "a system ffprobe."
        )

    result = run_command_capture(
        [
            FFPROBE,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            video_path,
        ]
    )

    if result is None:

        fail(
            "ffprobe could not be started."
        )

    if result.returncode != 0:

        fail(
            "Could not determine video duration.\n"
            + result.stderr
        )

    try:

        duration = float(
            result.stdout.strip()
        )

    except ValueError:

        fail(
            "ffprobe returned an invalid duration:\n"
            + result.stdout
        )

    if duration <= 0:

        fail(
            "Video duration is zero or negative."
        )

    return duration


# ============================================================
# TRANSCRIPT
# ============================================================

def transcript_path_for(
    video_path,
):
    return WORK_DIR / "transcript.json"


def validate_transcript(
    transcript_path,
    video_path,
    duration,
):

    check_file(
        transcript_path,
        "Whisper transcript",
    )

    try:

        with transcript_path.open(
            "r",
            encoding="utf-8",
        ) as file:

            data = json.load(file)

    except Exception as exc:

        fail(
            "Could not read Whisper transcript:\n"
            f"{exc}"
        )

    if not isinstance(
        data,
        dict,
    ):

        fail(
            "Whisper transcript has an invalid structure."
        )

    data["video"] = str(
        video_path
    )

    data["duration"] = round(
        duration,
        3,
    )

    with transcript_path.open(
        "w",
        encoding="utf-8",
    ) as file:

        json.dump(
            data,
            file,
            indent=2,
            ensure_ascii=False,
        )

    print()
    print(
        "Transcript verified."
    )

    print(
        f"Duration: {duration:.3f}s"
    )

    # Do not send an empty ASR result into the story analyzer.
    if not any(segment.get("text", "").strip() for segment in data.get("segments", [])):
        status = data.get("transcription_status", "no_words")
        if status == "no_speech":
            fail("ASR_NO_SPEECH: No clear spoken voice was detected. Choose a video with clear English or Hindi-English dialogue. Singing, music and 8D audio may not be recognized.")
        fail("ASR_NO_WORDS: Voice was detected, but no reliable words could be transcribed. Check the selected audio language or try a clearer spoken video.")


# ============================================================
# STORY EVENT MAP
# ============================================================

def prepare_story_event_map(
    transcript_path,
):

    source = STORY_EVENT_MAP_SCRIPT.read_text(
        encoding="utf-8"
    )

    marker = "TRANSCRIPT_FILE ="

    start = source.find(
        marker
    )

    if start == -1:

        fail(
            "Could not locate TRANSCRIPT_FILE "
            "in story_event_map.py."
        )

    end = source.find(
        "\n\n",
        start,
    )

    if end == -1:

        fail(
            "Could not determine the end of "
            "TRANSCRIPT_FILE configuration."
        )

    replacement = (
        "TRANSCRIPT_FILE = Path("
        + repr(
            str(transcript_path)
        )
        + ")"
    )

    patched = (
        source[:start]
        + replacement
        + source[end:]
    )

    output_marker = "OUTPUT_FILE = Path("
    output_start = patched.find(output_marker)
    if output_start == -1:
        raise SystemExit("STOP: OUTPUT_FILE configuration not found.")

    output_end = patched.find("\n\n", output_start)
    if output_end == -1:
        raise SystemExit("STOP: OUTPUT_FILE configuration boundary not found.")

    output_replacement = (
        "OUTPUT_FILE = Path("
        + repr(str(STORY_EVENT_MAP_FILE))
        + ")"
    )
    patched = (
        patched[:output_start]
        + output_replacement
        + patched[output_end:]
    )

    WORK_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    temp_script = (
        WORK_DIR
        / "story_event_map_runtime.py"
    )

    temp_script.write_text(
        patched,
        encoding="utf-8",
    )

    return temp_script


def run_story_event_map(
    transcript_path,
    audio_language="hinglish",
    allow_empty=False,
):

    PROCESS_ENV["SNIP_AI_EVENT_LANGUAGE"] = audio_language
    # The event map has a romanized Hindi vocabulary. Keep it enabled only
    # for Hinglish transcripts; the English scorer remains unchanged.
    if audio_language == "hinglish":
        PROCESS_ENV["SNIP_AI_HINGLISH_EVENT_SCORING"] = "1"
        print("Hinglish event scoring: ON")
    else:
        PROCESS_ENV.pop("SNIP_AI_HINGLISH_EVENT_SCORING", None)
        print(f"Event scoring language: {audio_language}")

    temp_script = (
        prepare_story_event_map(
            transcript_path
        )
    )

    try:

        run_command(
            [
                WHISPER_PYTHON,
                temp_script,
            ],
            "STORY EVENT MAP V3",
        )

    finally:

        try:

            temp_script.unlink()

        except FileNotFoundError:

            pass

    legacy_output = (
        DOWNLOADS_DIR
        / "story-event-map.json"
    )

    if legacy_output.exists():

        shutil.copy2(
            legacy_output,
            STORY_EVENT_MAP_FILE,
        )

    if not STORY_EVENT_MAP_FILE.exists():
        try:
            transcript = json.loads(
                Path(transcript_path).read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError):
            transcript = {}

        if transcript.get("transcription_status") in {"no_speech", "no_words"}:
            STORY_EVENT_MAP_FILE.parent.mkdir(parents=True, exist_ok=True)
            STORY_EVENT_MAP_FILE.write_text(
                json.dumps(
                    {
                        "duration": transcript.get("duration", 0),
                        "transcript_segments": 0,
                        "event_anchors": 0,
                        "event_combinations": 0,
                        "raw_standalone_clips": 0,
                        "strict_unique_candidates": 0,
                        "unique_standalone_clips": 0,
                        "events": [],
                        "moments": [],
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
        else:
            fail(
                "Story Event Map V3 completed but "
                "story-event-map.json was not found."
            )

    try:
        event_map = json.loads(
            STORY_EVENT_MAP_FILE.read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError) as error:
        fail(
            "Story Event Map V3 created an unreadable result.\n"
            f"Details: {error}"
        )

    moments = event_map.get("moments", [])
    if not moments and not allow_empty:
        try:
            transcript = json.loads(
                Path(transcript_path).read_text(encoding="utf-8")
            )
            segments = transcript.get("segments", [])
            word_count = sum(
                len(segment.get("words", []))
                for segment in segments
                if isinstance(segment, dict)
            )
            duration = float(transcript.get("duration", 0) or 0)
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            word_count = 0
            duration = 0

        if duration > 0:
            minutes, seconds = divmod(int(round(duration)), 60)
            duration_text = f"{minutes}m {seconds:02d}s"
        else:
            duration_text = "the full video"

        selected_language = (
            "Hinglish" if audio_language == "hinglish" else "English"
        )
        if transcript.get("transcription_status") == "no_speech":
            fail(
                "No clip moments were found because the speech detector found no clear "
                "voice regions in this video. Hinglish transcription was skipped to avoid "
                "turning game sounds or silence into fake words. This clip finder needs "
                "spoken commentary; it cannot currently select gameplay moments from "
                "visual action alone."
            )
        if transcript.get("transcription_status") == "no_words":
            fail(
                f"No clip moments were found. The speech detector found "
                f"{transcript.get('speech_regions', 0)} voice regions, but the selected "
                f"{selected_language} model returned no reliable timed words. Try the other "
                "audio language if it matches the speaker, or use a video with clearer speech."
            )
        advice = (
            "If the commentary is mostly English, choose English as the audio language. "
            "If the video has little or no spoken commentary, this speech based clip finder "
            "cannot identify reliable moments from it yet."
        )
        fail(
            "ASR_NO_MOMENTS: No clip moments were found. The story analyzer received "
            f"{word_count} timed words from {duration_text} of video and produced "
            "zero candidates. This usually means the audio has very little clear speech "
            f"or does not match the selected {selected_language} language.\n"
            f"{advice}"
        )


# ============================================================
# GENERATION SELECTOR
# ============================================================

def prepare_generation_selector(
    requested_clips=10,
):

    source = (
        GENERATION_SELECTOR_SCRIPT.read_text(
            encoding="utf-8"
        )
    )

    lines = source.splitlines()

    output = []

    i = 0

    while i < len(lines):

        line = lines[i]

        stripped = line.strip()

        if stripped.startswith(
            "INPUT_FILE = Path("
        ):

            output.append(
                "INPUT_FILE = Path("
                + repr(
                    str(
                        STORY_EVENT_MAP_FILE
                    )
                )
                + ")"
            )

            i += 1

            while (
                i < len(lines)
                and lines[i].strip() != ")"
            ):

                i += 1

            if i < len(lines):

                i += 1

            continue

        if stripped.startswith(
            "OUTPUT_FILE = Path("
        ):

            output.append(
                "OUTPUT_FILE = Path("
                + repr(
                    str(
                        SELECTED_GENERATION_FILE
                    )
                )
                + ")"
            )

            i += 1

            while (
                i < len(lines)
                and lines[i].strip() != ")"
            ):

                i += 1

            if i < len(lines):

                i += 1

            continue

        if stripped.startswith(
            "HISTORY_FILE = Path("
        ):

            output.append(
                "HISTORY_FILE = Path("
                + repr(
                    str(HISTORY_FILE)
                )
                + ")"
            )

            i += 1

            while (
                i < len(lines)
                and lines[i].strip() != ")"
            ):

                i += 1

            if i < len(lines):

                i += 1

            continue

        output.append(
            line
        )

        i += 1

    patched = (
        "\n".join(output)
        + "\n"
    )

    runtime_header = (
        "import sys\n"
        f"sys.path.insert(0, {str(PIPELINE_DIR)!r})\n"
        f"sys.argv = "
        f"[sys.argv[0], "
        f"\"{int(requested_clips)}\"]\n"
    )

    patched = (
        runtime_header
        + patched
    )

    temp_script = (
        WORK_DIR
        / "generation_selector_runtime.py"
    )

    temp_script.write_text(
        patched,
        encoding="utf-8",
    )

    return temp_script


def run_generation_selector(
    requested_clips=10,
):

    temp_script = (
        prepare_generation_selector(
            requested_clips
        )
    )

    try:

        run_command(
            [
                WHISPER_PYTHON,
                temp_script,
            ],
            "GENERATION SELECTOR",
        )

    finally:

        try:

            temp_script.unlink()

        except FileNotFoundError:

            pass

    if not SELECTED_GENERATION_FILE.exists():

        fail(
            "Generation Selector completed but "
            "selected-generation.json was not created."
        )


# ============================================================
# RENDERER
# ============================================================

def run_renderer(
    framing,
    caption_template="pop",
    different_captions=False,
):

    if framing not in (
        "1:1",
        "9:16",
        "16:9",
    ):

        fail(
            "Invalid framing mode.\n"
            "Allowed: 1:1 or 9:16"
        )

    allowed_caption_templates = {
        "pop", "karaoke", "bold-center", "punch", "minimal",
        "highlight-box", "typewriter", "bounce", "kinetic", "podcast",
    "yellow-stack", "violet-pill", "dual-line", "bold-karaoke", "soft-lyric",
    }

    if caption_template not in FFMPEG_CAPTION_TEMPLATES:

        fail(
            f"Invalid caption template: "
            f"{caption_template}"
        )

    run_command(
        [
            WHISPER_PYTHON,
            RENDER_SCRIPT,
            framing,
            SELECTED_GENERATION_FILE,
            OUTPUT_DIR,
            caption_template,
            (
                "true"
                if different_captions
                else "false"
            ),
        ],
        "VIDEO RENDER",
    )


# ============================================================
# OUTPUT
# ============================================================

def collect_outputs():

    if not OUTPUT_DIR.exists():

        fail(
            "Output directory was not created:\n"
            f"{OUTPUT_DIR}"
        )

    files = sorted(
        OUTPUT_DIR.glob(
            "snip_ai_simple_clip_*.mp4"
        )
    )

    valid = [
        path
        for path in files
        if path.is_file()
        and path.stem.removeprefix("snip_ai_simple_clip_").isdigit()
        and path.stat().st_size > 0
    ]

    if not valid:

        fail(
            "Renderer completed but no valid "
            "clips were found."
        )

    return valid


# ============================================================
# CLEAN WORKSPACE
# ============================================================

def prepare_workspace():

    WORK_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )


# ============================================================
# MAIN
# ============================================================

def windows_long_path(path):
    if os.name != "nt":
        return path
    absolute = os.path.abspath(path)
    prefix = "\\\\?\\"
    if absolute.startswith(prefix):
        return Path(absolute)
    if absolute.startswith("\\\\"):
        return Path(prefix + "UNC\\" + absolute[2:])
    return Path(prefix + absolute)


def save_clip_history(path, ranges):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix="hist-", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(ranges, stream)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def select_progressively(video, duration, language, count):
    cache_dir = Path(os.environ.get("SNIP_AI_TRANSCRIPT_CACHE_DIR", str(HOME_DIR / ".snip-ai" / "transcript-cache")))
    cache_source = os.environ.get("SNIP_AI_SCAN_SOURCE") or video
    range_key = os.environ.get("SNIP_AI_SCAN_RANGE", "")
    audio_cache = cache_path_for(cache_source, language + range_key, cache_dir).with_suffix(".w1")
    audio_cache.mkdir(parents=True, exist_ok=True)
    history_path = cache_path_for(cache_source, "clip-history" + range_key, cache_dir).with_suffix(".ranges.json")
    history_path = windows_long_path(history_path)
    history = json.loads(history_path.read_text(encoding="utf-8")) if history_path.exists() else []
    desired = requested_duration(os.environ.get("SNIP_AI_CLIP_DURATION_SECONDS"))
    window_size = max(75, (desired or 0) + 20)
    selected, segments = [], []
    fallback = []
    scanned = 0.0
    fresh_audio = 0.0
    chunks = [(i * duration / count, (i + 1) * duration / count) for i in range(count)]
    cursors = [start for start, _ in chunks]

    def overlaps(candidate, interval):
        start, end = interval
        intersection = min(end, candidate["end"]) - max(start, candidate["start"])
        return intersection > 0.05

    def accept(clip, transcript, offset):
        selected.append(clip)
        for segment in transcript["segments"]:
            if segment["end"] + offset <= clip["start"] or segment["start"] + offset >= clip["end"]:
                continue
            words = [{**word, "start": word["start"] + offset, "end": word["end"] + offset}
                     for word in segment.get("words", [])]
            segments.append({**segment, "start": segment["start"] + offset,
                             "end": segment["end"] + offset, "words": words})

    def pick(index):
        nonlocal scanned, fresh_audio
        _, limit = chunks[index]
        while cursors[index] < limit:
            start = cursors[index]
            end = min(limit, start + window_size)
            cursors[index] = limit if end == limit else end - 20
            if end - start < (desired or 10):
                continue
            span = end - start
            cached = audio_cache / f"{start:.6f}-{end:.6f}.json"
            print(f"SNIP_PROGRESSIVE: section {index + 1}/{count}, {start:.0f}–{end:.0f}s, {len(selected)}/{count} clips found", flush=True)
            if not cached.exists():
                audio = WORK_DIR / "scan-window.wav"
                local = WORK_DIR / "scan-window.json"
                local.unlink(missing_ok=True)
                run_command([FFMPEG, "-y", "-v", "error", "-ss", str(start), "-i", video,
                             "-t", str(span), "-vn", "-ac", "1", "-ar", "16000", audio], "EXTRACT AUDIO WINDOW")
                PROCESS_ENV["SNIP_AI_TRANSCRIPT_PATH"] = str(local)
                run_command([WHISPER_PYTHON, WHISPER_SCRIPT, audio, language], "WHISPER TRANSCRIPTION")
                temporary = cached.with_suffix(".tmp")
                shutil.copyfile(local, temporary)
                os.replace(temporary, cached)
                audio.unlink(missing_ok=True)
                fresh_audio += span
                transcript_path = cached if cached.exists() else local
            else:
                transcript_path = cached
            scanned += span
            transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
            if not transcript.get("segments"):
                continue
            transcript["duration"] = span
            STORY_EVENT_MAP_FILE.unlink(missing_ok=True)
            run_story_event_map(transcript_path, language, allow_empty=True)
            moments = json.loads(STORY_EVENT_MAP_FILE.read_text(encoding="utf-8")).get("moments", [])
            for moment in sorted(fit_moments(moments, desired, transcript), key=lambda m: m["score"], reverse=True):
                clip = {**moment, "start": round(moment["start"] + start, 3),
                        "end": round(moment["end"] + start, 3)}
                used = history + [[m["start"], m["end"]] for m in selected]
                if any(overlaps(clip, interval) for interval in used):
                    continue
                if clip["end"] > limit + .001:
                    continue
                if moment["score"] < 12:
                    if moment["score"] >= 8 and len(str(moment.get("text", "")).split()) >= 12:
                        fallback.append((clip, transcript, start))
                    continue
                accept(clip, transcript, start)
                cursors[index] = start
                return True
        return False

    for index in range(count):
        pick(index)
    while len(selected) < count:
        previous = len(selected)
        for index in range(count):
            if len(selected) == count:
                break
            pick(index)
        if len(selected) == previous:
            break
    for clip, transcript, start in sorted(fallback, key=lambda entry: entry[0]["score"], reverse=True):
        if len(selected) == count:
            break
        used = history + [[m["start"], m["end"]] for m in selected]
        if not any(overlaps(clip, interval) for interval in used):
            accept({**clip, "selection_tier": "fallback"}, transcript, start)
    transcript_path = WORK_DIR / "transcript.json"
    segments.sort(key=lambda segment: segment["start"])
    transcript_path.write_text(json.dumps({"duration": duration, "segments": segments}), encoding="utf-8")
    PROCESS_ENV["SNIP_AI_TRANSCRIPT_PATH"] = str(transcript_path)
    SELECTED_GENERATION_FILE.write_text(json.dumps({"video": str(video), "clips": selected,
        "transcript": str(transcript_path), "requested_count": count}), encoding="utf-8")
    print(f"SNIP_PROGRESSIVE_SUMMARY: {len(selected)}/{count} clips, {fresh_audio:.1f}s fresh transcription, {scanned:.1f}s scanned", flush=True)
    return history_path, history, selected


def main():

    if len(sys.argv) < 2:

        print()
        print("Usage:")
        print(
            "python pipeline_runner.py "
            "/path/to/video.mp4 "
            "[1:1|9:16] "
            "[clips] "
            "[caption template] "
            "[different captions]"
        )

        print()

        sys.exit(1)

    video_path = (
        Path(sys.argv[1])
        .expanduser()
        .resolve()
    )

    framing = (
        sys.argv[2]
        if len(sys.argv) >= 3
        else "1:1"
    )

    try:

        requested_clips = int(
            sys.argv[3]
            if len(sys.argv) >= 4
            else "5"
        )

    except ValueError:

        fail(
            "Clip count must be a whole number from 1 to 10."
        )

    caption_template = (
        sys.argv[4]
        if len(sys.argv) >= 5
        else "pop"
    )

    different_captions = (
        sys.argv[5].strip().lower()
        == "true"
        if len(sys.argv) >= 6
        else False
    )

    audio_language = (
        sys.argv[6].strip().lower()
        if len(sys.argv) >= 7
        else "hinglish"
    )
    if audio_language not in {"english", "hinglish", "hindi", "spanish", "french", "german", "tamil", "telugu", "bengali", "marathi", "gujarati", "punjabi", "kannada", "malayalam"}:
        fail("Unsupported audio language. Choose one of the languages shown in the app.")

    allowed_caption_templates = {
        "pop", "karaoke", "bold-center", "punch", "minimal",
        "highlight-box", "typewriter", "bounce", "kinetic", "podcast",
    "yellow-stack", "violet-pill", "dual-line", "bold-karaoke", "soft-lyric",
    "none",
    }

    if caption_template not in allowed_caption_templates:

        fail(
            f"Invalid caption template: "
            f"{caption_template}"
        )

    if requested_clips != -1 and (requested_clips < 1 or requested_clips > 20):

        fail(
            "Clip count must be between 1 and 20, or All."
        )

    if framing not in (
        "1:1",
        "9:16",
        "16:9",
    ):

        fail(
            "Invalid framing mode.\n"
            "Allowed: 1:1 or 9:16"
        )

    started = time.perf_counter()

    print()
    print("=" * 72)
    print("SNIP AI â€” PORTABLE PIPELINE V4")
    print("=" * 72)

    print()
    print(
        f"Input video : {video_path}"
    )

    print(
        f"Framing     : {framing}"
    )

    print(
        f"Project     : {BASE_DIR}"
    )

    print(
        f"Work folder : {WORK_DIR}"
    )

    print(
        f"Output      : {OUTPUT_DIR}"
    )

    print(
        f"Runtime     : "
        f"{RUNTIME_ROOT if RUNTIME_ROOT else 'LOCAL'}"
    )

    print(
        f"Python      : {WHISPER_PYTHON}"
    )

    print(
        f"FFmpeg      : "
        f"{FFMPEG if FFMPEG else 'SYSTEM/PATH'}"
    )

    print(
        f"FFprobe     : "
        f"{FFPROBE if FFPROBE else 'SYSTEM/PATH'}"
    )

    # --------------------------------------------------------
    # Input validation
    # --------------------------------------------------------

    if not video_path.exists():

        fail(
            f"Video not found:\n"
            f"{video_path}"
        )

    if not video_path.is_file():

        fail(
            f"Input is not a file:\n"
            f"{video_path}"
        )

    # --------------------------------------------------------
    # Environment validation
    # --------------------------------------------------------

    check_file(
        WHISPER_PYTHON,
        "Whisper Python environment",
    )

    check_file(
        WHISPER_SCRIPT,
        "Whisper transcription script",
    )

    check_file(
        STORY_EVENT_MAP_SCRIPT,
        "Story Event Map script",
    )

    check_file(
        GENERATION_SELECTOR_SCRIPT,
        "Generation Selector script",
    )

    check_file(
        RENDER_SCRIPT,
        "Simple renderer",
    )

    if FFPROBE is None:

        fail(
            "ffprobe was not found."
        )

    if FFMPEG is None:

        fail(
            "ffmpeg was not found."
        )

    # --------------------------------------------------------
    # Prepare
    # --------------------------------------------------------

    prepare_workspace()

    # Persist hardware choices per user on first processing run. Keep CPU fallback
    # available in whisper_transcribe.py if CUDA cannot initialize later.
    hardware = get_or_detect(WHISPER_PYTHON, FFMPEG)
    transcription_hardware = hardware["transcription"]
    PROCESS_ENV["SNIP_AI_WHISPER_DEVICE"] = transcription_hardware.get(
        "faster_whisper_device", "cuda" if transcription_hardware.get("device") == "cuda" else "cpu"
    )
    PROCESS_ENV["SNIP_AI_SWIFT_DEVICE"] = transcription_hardware.get("swift_device", "cpu")
    PROCESS_ENV["SNIP_AI_VIDEO_ENCODER"] = hardware["video"]["mode"]

    duration = get_video_duration(
        video_path
    )

    print()
    print(
        f"Video duration: {duration:.3f}s"
    )

    # --------------------------------------------------------
    # 1. Whisper
    # --------------------------------------------------------

    if os.environ.get("SNIP_AI_PROGRESSIVE") == "1":
        history_path, history, selected = select_progressively(video_path, duration, audio_language, requested_clips)
        if not selected:
            fail("No unused clips met the quality threshold. Try another range or audio language.")
        run_renderer(framing, caption_template, different_captions)
        outputs = collect_outputs()
        # Filenames keep the original selection index even if a clip fails.
        completed = {
            int(output.stem.rsplit("_", 1)[-1])
            for output in outputs
            if output.stem.rsplit("_", 1)[-1].isdigit()
        }
        if len(completed) != len(selected):
            print(f"Partial render: {len(completed)}/{len(selected)} clips completed.", flush=True)
        save_clip_history(history_path, history + [
            [moment["start"], moment["end"]]
            for index, moment in enumerate(selected, 1)
            if index in completed
        ])
        return

    transcript_path, transcript_cache = prepare_transcript(
        video_path, audio_language, WORK_DIR,
        Path(os.environ.get("SNIP_AI_TRANSCRIPT_CACHE_DIR", str(HOME_DIR / ".snip-ai" / "transcript-cache"))),
    )

    # Keep Whisper's output and the pipeline's validator on the same path.
    # The app process can inherit SNIP_AI_TRANSCRIPT_PATH from unrelated
    # benchmark/manual runs; explicitly pin it to this job's local transcript.
    PROCESS_ENV["SNIP_AI_TRANSCRIPT_PATH"] = str(
        transcript_path
    )

    print(
        f"Transcript output: {transcript_path}"
    )

    run_command(
        [
            WHISPER_PYTHON,
            WHISPER_SCRIPT,
            video_path,
            audio_language,
        ],
        "WHISPER TRANSCRIPTION",
    )

    validate_transcript(
        transcript_path,
        video_path,
        duration,
    )
    save_transcript_cache(transcript_path, transcript_cache)

    # --------------------------------------------------------
    # 2. Story Event Map V3
    # --------------------------------------------------------

    run_story_event_map(
        transcript_path,
        audio_language,
    )

    # --------------------------------------------------------
    # 3. Generation Selector
    # --------------------------------------------------------

    run_generation_selector(
        requested_clips
    )

    # --------------------------------------------------------
    # Validate selected generation
    # --------------------------------------------------------

    try:

        generation_data = json.loads(
            SELECTED_GENERATION_FILE.read_text(
                encoding="utf-8"
            )
        )

    except Exception as exc:

        fail(
            "Could not read selected generation:\n"
            f"{exc}"
        )

    clips = generation_data.get(
        "clips",
        [],
    )

    if not clips:

        fail(
            "Generation Selector returned zero clips."
        )

    print()

    print(
        f"Generation: "
        f"{generation_data.get('generation', '?')}"
    )

    print(
        f"Selected clips: {len(clips)}"
    )

    # --------------------------------------------------------
    # 4. Renderer
    # --------------------------------------------------------

    run_renderer(
        framing,
        caption_template,
        different_captions,
    )

    # --------------------------------------------------------
    # 5. Collect
    # --------------------------------------------------------

    outputs = collect_outputs()

    # --------------------------------------------------------
    # Final
    # --------------------------------------------------------

    total_time = (
        time.perf_counter()
        - started
    )

    print()
    print("=" * 72)
    print("SNIP AI â€” PIPELINE COMPLETE")
    print("=" * 72)

    print()

    print(
        f"Generation : "
        f"{generation_data.get('generation', '?')}"
    )

    print(
        f"Framing    : {framing}"
    )

    print(
        f"Clips      : {len(outputs)}"
    )

    print(
        f"Output     : {OUTPUT_DIR}"
    )

    print(
        f"Total time : {total_time:.1f}s"
    )

    print()
    print("FILES")
    print("-" * 72)

    for index, path in enumerate(
        outputs,
        start=1,
    ):

        size_mb = (
            path.stat().st_size
            / (1024 * 1024)
        )

        print(
            f"{index:02d}. "
            f"{path.name} "
            f"({size_mb:.1f} MB)"
        )

    print()
    print("=" * 72)


if __name__ == "__main__":
    main()
