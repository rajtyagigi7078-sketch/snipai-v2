# Snip AI 0.2.10: portable Windows CPU dependency repair

The reported new-laptop transcription failure was a Windows native-loader failure: CTranslate2 was present, but its Microsoft C++ runtime dependencies were not all app-local. This release bundles signed Microsoft runtime DLLs beside both Python and Node and includes the official offline Microsoft redistributable for repair.

The installer checks native components before reporting success. Generation also checks the runtime before starting, and a failed check offers Repair runtime and a selectable/copyable diagnostic report. Existing activation storage and key compatibility are unchanged.

## Verification

- Tested the extracted final installer payload, version 0.2.10, with offline model flags, an empty test model cache and PATH restricted to bundled Python/Node plus Windows System32.
- All nine runtime checks passed: NumPy, PyAV, ONNX Runtime, CTranslate2, faster-whisper, speech detector, FFmpeg, FFprobe and Node ONNX runtime. Windows loaded the three principal MSVC DLLs from the bundled Python folder.
- Native import audit: 242 PE files checked, no missing MSVC dependency; 19 packaged native files verified against their SHA-256 manifest.
- Actual installer payload generated Hinglish 9:16 and English 1:1 / 16:9 test jobs. Each generated a 15-second MP4 with audio; transcript edits, caption settings, logo/text overlays, saved edits and export were verified.
- The installer Pythonw health-check command passed. The repair/UAC fallback was not exercised on a clean VM without the Microsoft runtime.
- Eighteen process, progress, runtime-gate and activation-migration tests and six transcript/duration tests passed. Production frontend build passed. Diagnostic UI fixture checked at 1366x768 and 1100x720.

Installer: 778,157,163 bytes (742.11 MiB), approximately 18.76 MiB more than 0.2.9. CUDA is not bundled.

Scope: Windows 10/11 x64. These checks do not establish compatibility with every computer or every media file. No fresh native-app UI automation was performed; component UI and actual packaged media backend were tested separately. A clean Windows VM test remains useful before claiming system-wide portability. Corrupt, unsupported or dialogue-free inputs can still require a clear error instead of a clip.
