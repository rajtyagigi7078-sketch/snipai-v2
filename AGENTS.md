# Snip AI — AI Coding Instructions

## Project architecture

- `src/`: React + TypeScript frontend and UI styling.
- `src-tauri/src/`: Rust desktop backend and native process management.
- `src-tauri/tauri.conf.json`: Tauri app and installer configuration.
- `windows-runtime/pipeline/`: Python pipeline and clip orchestration.
- `windows-runtime/pipeline/ffmpeg-captions/`: active bundled FFmpeg caption engine.
- `windows-runtime/pipeline/fonts/`: caption fonts.
- `windows-runtime/pipeline/swift-node/`: Node.js Swift Hinglish transcription runtime.
- `windows-runtime/python/`, `node/`, `ffmpeg/`, `whisper-model/`: bundled Windows dependencies.
- `snip-caption-renderer/`: caption engine source; verify actual references before editing.
- `supabase/`: database migrations and edge functions related to configured backend features.
- `docs/`: architecture and development documentation.
- `.vscode/`: editor settings and development tasks.

## Important rules

1. Inspect call sites and imports before changing or moving a file.
2. Do not move runtime files without updating and testing every consumer.
3. The active clip-caption rendering path uses FFmpeg. Do not reintroduce a mandatory Remotion dependency.
4. Keep the bundled runtime paths explicit. Do not silently fall back to globally installed Python, Node.js, or FFmpeg in a packaged release.
5. Keep Whisper and Swift Hinglish model loading compatible with offline use. Test local model resolution instead of assuming it works.
6. Never put API keys, passwords, signing secrets, or private credentials in source code or Git commits.
7. Never delete backups, generated assets, or legacy folders without checking references and preserving recoverability.
8. Do not run `git add .`, force-push, or reuse an existing release tag.
9. Before edits, inspect the relevant source and make a backup when a risky change is necessary.
10. After edits, run the narrowest relevant checks, then the broader build. Report actual failures instead of claiming success.

## Feature ownership

- UI and layout: `src/`
- Native commands and process launching: `src-tauri/src/lib.rs`
- Pipeline orchestration: `windows-runtime/pipeline/pipeline_runner.py`
- Speech transcription: `windows-runtime/pipeline/whisper_transcribe.py`
- Clip rendering: `windows-runtime/pipeline/render_clips_simple.py`
- Caption preview: `windows-runtime/pipeline/render_caption_preview.py`
- Caption templates and FFmpeg filters: `windows-runtime/pipeline/ffmpeg-captions/`
- Runtime bundling: `src-tauri/tauri.conf.json`
- Build scripts and JS dependencies: `package.json`
- License/auth backend: inspect `src/` and `supabase/` before changing.

This document describes the intended ownership. Confirm current call sites before relying on any assumed connection.