import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(1)

if len(sys.argv) != 5:
    fail("Usage: render_caption_preview.py THEME OUTPUT.mp4 SOURCE_VIDEO FORMAT")

theme, output_path = sys.argv[1], Path(sys.argv[2])
source_video = Path(sys.argv[3]) if sys.argv[3] else None
video_format = sys.argv[4] if sys.argv[4] in {"1:1", "9:16", "16:9"} else "1:1"
if source_video is not None and not source_video.is_file():
    fail("Preview source video was not found: " + str(source_video))
engine = Path(os.environ.get("SNIP_AI_CAPTION_ENGINE", ""))
if not engine.is_file():
    fail("Caption engine not found: " + str(engine))

ffmpeg = os.environ.get("SNIP_AI_FFMPEG") or shutil.which("ffmpeg")
node_env = os.environ.get("SNIP_AI_NODE")
node = node_env if node_env and Path(node_env).is_file() else shutil.which("node")
if not ffmpeg:
    fail("FFmpeg executable was not found.")
if not node:
    fail("Node.js executable was not found.")

allowed = {
    "pop", "karaoke", "bold-center", "punch", "minimal",
    "highlight-box", "typewriter", "bounce", "kinetic", "podcast",
    "yellow-stack", "violet-pill", "dual-line", "bold-karaoke", "soft-lyric"
}
if theme not in allowed:
    fail("Unknown caption theme: " + theme)

if theme == "typewriter":
    # Shorter sample keeps the animated characters readable in landscape cards.
    words = [{"text": "SNIP AI IN MOTION", "start": 0.18, "end": 3.95}]
else:
    words = [
        {"text": "THIS", "start": 0.18, "end": 1.05},
        {"text": "IS", "start": 1.05, "end": 1.45},
        {"text": "SNIP", "start": 1.45, "end": 2.05},
        {"text": "AI", "start": 2.05, "end": 2.50},
        {"text": "CAPTIONS", "start": 2.50, "end": 3.15},
        {"text": "IN", "start": 3.15, "end": 3.50},
        {"text": "MOTION", "start": 3.50, "end": 3.95},
    ]

font_map = {
    "pop": "Poppins.ttf",
    "karaoke": "LeagueSpartan.ttf",
    "bold-center": "Anton.ttf",
    "punch": "AlfaSlabOne.ttf",
    "minimal": "Nunito.ttf",
    "highlight-box": "Kanit.ttf",
    "typewriter": "Teko.ttf",
    "bounce": "Rubik.ttf",
    "kinetic": "Oswald.ttf",
    "podcast": "BebasNeue.ttf",
    "yellow-stack": "Anton.ttf",
    "violet-pill": "Poppins.ttf",
    "dual-line": "Anton.ttf",
    "bold-karaoke": "Anton.ttf",
    "soft-lyric": "Nunito.ttf",
}
font_name = font_map.get(theme)
if not font_name:
    fail("No bundled font mapping for caption theme: " + theme)
font_path = (Path(__file__).resolve().parent / "fonts" / font_name).resolve()
if not font_path.is_file():
    fail("Bundled caption font not found: " + str(font_path))
font_file = str(font_path)

width, height = (360, 360) if video_format == "1:1" else (640, 360)
options = {
    "template": theme,
    "width": width,
    "height": height,
    "fontSize": (58 if video_format == "1:1" else 64) if theme != "typewriter" else 48,
}
if font_file:
    options["fontFile"] = font_file
if theme == "dual-line":
    options["secondaryFontFile"] = str((Path(__file__).resolve().parent / "fonts" / "Nunito.ttf").resolve())

request = json.dumps({"words": words, "options": options})
result = subprocess.run(
    [node, str(engine)],
    input=request,
    text=True,
    capture_output=True,
    timeout=30,
)
if result.returncode != 0:
    fail("Caption engine failed: " + (result.stderr.strip() or result.stdout.strip()))

try:
    filter_result = json.loads(result.stdout)
except Exception as exc:
    fail("Caption engine returned invalid JSON: " + str(exc))

caption_filter = filter_result.get("filter", "")
if not caption_filter:
    fail("Caption engine returned an empty filter.")

output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.unlink(missing_ok=True)

if source_video is not None:
    scale_crop = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss", "0",
        "-i", str(source_video), "-t", "4", "-vf", f"{scale_crop},{caption_filter}",
        "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "ultrafast",
        "-crf", "25", "-threads", "2", "-c:a", "aac", "-b:a", "96k", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(output_path),
    ]
else:
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", f"color=c=#000000:s={width}x{height}:r=30:d=4",
        "-vf", caption_filter, "-t", "4", "-an", "-c:v", "libx264", "-preset", "ultrafast",
        "-crf", "25", "-threads", "2", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output_path),
    ]
render = None
for attempt in range(4):
    try:
        render = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        break
    except PermissionError as exc:
        # Windows can briefly lock the bundled FFmpeg executable while the
        # desktop runtime is refreshing files. Retry only that transient case.
        if os.name != "nt" or getattr(exc, "winerror", None) != 32 or attempt == 3:
            raise
        time.sleep(0.25 * (attempt + 1))
if render is None:
    fail("FFmpeg preview could not be started.")
if render.returncode != 0 or not output_path.is_file() or output_path.stat().st_size < 1024:
    output_path.unlink(missing_ok=True)
    fail("FFmpeg preview render failed: " + (render.stderr.strip() or "no output"))

print(str(output_path))

