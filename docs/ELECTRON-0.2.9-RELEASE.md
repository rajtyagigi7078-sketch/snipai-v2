# Snip AI 0.2.9 Windows CPU release

Electron desktop release with bundled Python, FFmpeg, Node and transcription models. CUDA is not bundled.

- 35 caption templates (15 Snip AI and 20 Capsnip typography styles), lightweight previews, clip-duration selection and 9:16 framing.
- Per-clip editor for transcript, caption colours/size, all-caption and per-line positioning, text and logo overlays. Save changes to MP4 before exporting.
- Preview immediately shows the generated MP4 while an editable source is prepared. Transport width follows the video frame.
- Typography is painted separately from React controls. Preview canvas allocation follows the visible frame instead of resetting a full-resolution canvas each frame; export resolution is unchanged.
- Pipeline progress, measured estimates, standby-aware deadlines, job-local transcript files and readable no-dialogue messages.
- Existing installation identity migration and key activation retained; logout supports device release.

Verification: 12 process/progress tests and 6 transcript/duration tests passed. Packaged runtime generated a 15-second 1080×1920 clip, edited transcript/text/caption styling, saved and exported MP4 with audio. Synthetic silence produced the expected no-speech result. Isolated component playback test advanced 4.47 seconds with 269 frames, zero dropped frames and zero canvas reallocations. This fixture result is not a guarantee for every computer or source codec. UI screenshot previews use isolated components and sample data; installed native UI automation was unavailable.

Store update: product banners, features, ten canonical typography examples, key-save/Windows download instructions, Gmail support and same-browser checkout recovery for 30 days. No license keys are saved by the store; recovery retains the existing private order claim token locally.
