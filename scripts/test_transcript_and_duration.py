import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "windows-runtime" / "pipeline"))
from transcript_workspace import prepare_transcript, save_transcript_cache, cache_path_for
from clip_duration import requested_duration, fit_moments


class TranscriptWorkspaceTests(unittest.TestCase):
    def test_read_only_source_is_never_written(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "phone" / "video.mp4"
            source.parent.mkdir()
            source.write_bytes(b"video")
            sidecar = source.with_suffix(".transcript.json")
            sidecar.write_text('{"video":"original"}')
            original_open = Path.open
            def guarded_open(path, mode="r", *args, **kwargs):
                if path.parent == source.parent and any(flag in mode for flag in "wax+"):
                    raise PermissionError("Source is read-only")
                return original_open(path, mode, *args, **kwargs)
            with patch.object(Path, "open", guarded_open):
                local, cached = prepare_transcript(source, "hinglish", root / "job", root / "cache")
                self.assertEqual(local.parent, root / "job")
                local.write_text('{"video":"validated"}')
                save_transcript_cache(local, cached)
                second, _ = prepare_transcript(source, "hinglish", root / "second-job", root / "cache")
                self.assertEqual(json.loads(second.read_text())["video"], "validated")
            self.assertEqual(json.loads(sidecar.read_text())["video"], "original")

    def test_cache_distinguishes_languages_and_changed_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "v.mp4"
            source.write_bytes(b"first")
            old = cache_path_for(source, "english", directory)
            self.assertNotEqual(old, cache_path_for(source, "hinglish", directory))
            source.write_bytes(b"changed file")
            self.assertNotEqual(old, cache_path_for(source, "english", directory))


class DurationTests(unittest.TestCase):
    def test_reject_invalid_lengths(self):
        for value in (-1, 9, 121, 15.5, "nan", "inf"):
            with self.assertRaises(ValueError):
                requested_duration(value)
        self.assertIsNone(requested_duration("auto"))

    def test_requested_lengths_fit_edges_and_preserve_word_content(self):
        transcript = {"duration": 150, "segments": [{"words": [{"text": str(i), "start": i, "end": i + .8} for i in range(150)]}]}
        moments = [{"start": 0, "end": 12, "score": 15}, {"start": 140, "end": 150, "score": 20}]
        for seconds in (15, 30, 45, 60, 90, 120):
            for clip in fit_moments(moments, seconds, transcript):
                self.assertEqual(clip["end"] - clip["start"], seconds)
                self.assertGreaterEqual(clip["start"], 0)
                self.assertLessEqual(clip["end"], 150)
                self.assertEqual(len(clip["text"].split()), seconds)

    def test_too_short_source_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "shorter"):
            fit_moments([], 60, {"duration": 20})

    def test_auto_keeps_original_moment_boundaries(self):
        moments = [{"start": 3, "end": 28}]
        self.assertIs(fit_moments(moments, None, {}), moments)


if __name__ == "__main__":
    unittest.main()
