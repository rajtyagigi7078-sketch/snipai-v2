use tauri::{Emitter, Manager};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::io::{BufRead, BufReader};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::hash::{Hash, Hasher};
use std::collections::hash_map::DefaultHasher;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Default)]
struct PipelineControl {
    active: bool,
    pid: Option<u32>,
    cancel_requested: bool,
}

static PIPELINE_CONTROL: Mutex<PipelineControl> = Mutex::new(PipelineControl {
    active: false,
    pid: None,
    cancel_requested: false,
});

struct PipelineRequestGuard;

fn normalize_caption_overrides_json(raw: &str) -> Result<String, String> {
    let parsed: serde_json::Value = serde_json::from_str(if raw.trim().is_empty() { "{}" } else { raw })
        .map_err(|_| "Caption appearance settings are invalid.".to_string())?;
    let object = parsed.as_object().ok_or_else(|| "Caption appearance settings must be an object.".to_string())?;
    let mut clean = serde_json::Map::new();
    for key in ["primaryColor", "accentColor", "titleColor", "boxColor"] {
        if let Some(value) = object.get(key) {
            let color = value.as_str().ok_or_else(|| format!("{} must be a hex color.", key))?;
            let digits = color.strip_prefix('#').unwrap_or(color);
            if digits.len() != 6 || !digits.chars().all(|ch| ch.is_ascii_hexdigit()) {
                return Err(format!("{} must be a six-digit hex color.", key));
            }
            clean.insert(key.to_string(), serde_json::Value::String(format!("#{}", digits)));
        }
    }
    if let Some(value) = object.get("titleText") {
        let text = value.as_str().ok_or_else(|| "titleText must be text.".to_string())?;
        let safe_text: String = text.chars().filter(|ch| !ch.is_control()).take(120).collect();
        clean.insert("titleText".to_string(), serde_json::Value::String(safe_text));
    }
    if let Some(value) = object.get("animation") {
        let animation = value.as_str().ok_or_else(|| "animation must be a supported caption motion.".to_string())?;
        if !["template", "fade", "side-reveal", "blur-in", "single"].contains(&animation) {
            return Err("Choose a supported caption motion.".to_string());
        }
        if animation != "template" {
            clean.insert("animation".to_string(), serde_json::Value::String(animation.to_string()));
        }
    }
    if let Some(value) = object.get("logoPath") {
        let raw_path = value.as_str().ok_or_else(|| "logoPath must be a local image path.".to_string())?;
        if !raw_path.is_empty() {
            if raw_path.len() > 2048 {
                return Err("Logo path is too long.".to_string());
            }
            let path = PathBuf::from(raw_path);
            let extension = path.extension().and_then(|part| part.to_str()).unwrap_or("").to_ascii_lowercase();
            if !["png", "jpg", "jpeg", "webp"].contains(&extension.as_str()) || !path.is_file() {
                return Err("Choose an existing PNG, JPEG, or WebP logo image.".to_string());
            }
            clean.insert("logoPath".to_string(), serde_json::Value::String(path.to_string_lossy().to_string()));
        }
    }
    for (key, min, max) in [
        ("fontScale", 75.0, 150.0),
        ("verticalPosition", 0.35, 0.82),
        ("titleScale", 75.0, 150.0),
        ("titlePosition", 0.1, 0.9),
        ("lineHeightRatio", 1.0, 1.5),
        ("logoScale", 5.0, 35.0),
        ("logoOpacity", 0.2, 1.0),
        ("logoX", 0.0, 1.0),
        ("logoY", 0.0, 1.0),
    ] {
        if let Some(value) = object.get(key) {
            let number = value.as_f64().ok_or_else(|| format!("{} must be a number.", key))?;
            clean.insert(key.to_string(), serde_json::json!(number.clamp(min, max)));
        }
    }
    Ok(serde_json::Value::Object(clean).to_string())
}

#[derive(serde::Serialize)]
struct GeneratedClipsResult {
    paths: Vec<String>,
    social_captions: Vec<String>,
}

impl Drop for PipelineRequestGuard {
    fn drop(&mut self) {
        if let Ok(mut control) = PIPELINE_CONTROL.lock() {
            control.active = false;
            control.pid = None;
            control.cancel_requested = false;
        }
    }
}

fn persist_process_output(
    output_dir: &Path,
    log_name: &str,
    stdout: &[u8],
    stderr: &[u8],
) -> (PathBuf, String) {
    let stdout = String::from_utf8_lossy(stdout);
    let stderr = String::from_utf8_lossy(stderr);
    let log = format!("=== stdout ===\n{}\n=== stderr ===\n{}", stdout, stderr);
    let log_path = output_dir.join(log_name);
    let save_note = match fs::write(&log_path, log.as_bytes()) {
        Ok(()) => String::new(),
        Err(error) => format!("\nCould not save full log: {}", error),
    };
    let tail = log
        .chars()
        .rev()
        .take(12_000)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    (log_path, format!("{}{}", tail, save_note))
}

fn stream_child_output(
    app: &tauri::AppHandle,
    mut child: Child,
    output_dir: &Path,
    log_name: &str,
) -> Result<(ExitStatus, PathBuf, String), String> {
    let pid = child.id();
    let cancel_on_start = {
        let mut control = PIPELINE_CONTROL
            .lock()
            .map_err(|_| "Pipeline control state is unavailable.".to_string())?;
        control.pid = Some(pid);
        let cancel = control.cancel_requested;
        control.cancel_requested = false;
        cancel
    };
    if cancel_on_start {
        let _ = terminate_process_tree(pid);
    }
    let (line_tx, line_rx) = mpsc::channel::<(bool, String)>();

    if let Some(stdout) = child.stdout.take() {
        let tx = line_tx.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().flatten() {
                let _ = tx.send((true, line));
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let tx = line_tx.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().flatten() {
                let _ = tx.send((false, line));
            }
        });
    }
    drop(line_tx);

    let mut stdout_log = String::new();
    let mut stderr_log = String::new();
    for (is_stdout, line) in line_rx {
        let log = if is_stdout { &mut stdout_log } else { &mut stderr_log };
        log.push_str(&line);
        log.push('\n');
        let _ = app.emit("pipeline-progress", line);
    }

    let status = child.wait().map_err(|error| {
        if let Ok(mut control) = PIPELINE_CONTROL.lock() {
            if control.pid == Some(pid) {
                control.pid = None;
            }
        }
        format!("Could not wait for pipeline process: {}", error)
    })?;
    if let Ok(mut control) = PIPELINE_CONTROL.lock() {
        if control.pid == Some(pid) {
            control.pid = None;
        }
        control.cancel_requested = false;
    }

    let (log_path, log_tail) = persist_process_output(
        output_dir,
        log_name,
        stdout_log.as_bytes(),
        stderr_log.as_bytes(),
    );
    Ok((status, log_path, log_tail))
}

fn terminate_process_tree(pid: u32) -> Result<(), String> {
    let pid_text = pid.to_string();
    #[cfg(target_os = "windows")]
    let result = {
        let mut command = Command::new("taskkill");
        command.creation_flags(0x08000000);
        command.args(["/PID", &pid_text, "/T", "/F"]).output()
    };
    #[cfg(not(target_os = "windows"))]
    let result = Command::new("kill")
        .args(["-TERM", &pid_text])
        .output();
    let result = result.map_err(|error| {
        format!("Could not stop the active render process: {}", error)
    })?;
    if !result.status.success() {
        return Err(format!(
            "Could not stop render process {}. {}",
            pid,
            String::from_utf8_lossy(&result.stderr).trim()
        ));
    }
    Ok(())
}

fn begin_pipeline_request() -> Result<PipelineRequestGuard, String> {
    let mut control = PIPELINE_CONTROL
        .lock()
        .map_err(|_| "Pipeline control state is unavailable.".to_string())?;
    if control.active {
        return Err("Another video job is already running.".to_string());
    }
    control.active = true;
    control.cancel_requested = false;
    Ok(PipelineRequestGuard)
}

#[tauri::command]
fn cancel_processing(app: tauri::AppHandle) -> Result<(), String> {
    let pid = {
        let mut control = PIPELINE_CONTROL
            .lock()
            .map_err(|_| "Pipeline control state is unavailable.".to_string())?;
        if !control.active {
            return Err("There is no active video job to stop.".to_string());
        }
        control.cancel_requested = true;
        let pid = control.pid;
        if pid.is_some() {
            control.cancel_requested = false;
        }
        pid
    };
    if let Some(pid) = pid {
        terminate_process_tree(pid)?;
    }
    let _ = app.emit("pipeline-progress", "Stopping the current jobâ€¦");
    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

// ------------------------------------------------------------
// Resolve Snip AI runtime root
//
// Production:
//   Tauri bundled resource directory/windows-runtime
//
// Development fallback:
//   clipper/windows-runtime
//
// ------------------------------------------------------------

fn resolve_runtime_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| {
            format!(
                "Could not resolve Tauri resource directory:\n{}",
                error
            )
        })?;

    let bundled_runtime = resource_dir.join("windows-runtime");

    if bundled_runtime.is_dir() {
        return Ok(bundled_runtime);
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    let clipper_dir = manifest_dir
        .parent()
        .ok_or_else(|| {
            "Could not resolve clipper directory.".to_string()
        })?;

    let development_runtime =
        clipper_dir.join("windows-runtime");

    if development_runtime.is_dir() {
        return Ok(development_runtime);
    }

    Err(format!(
        "Snip AI runtime was not found.\n\nChecked:\n{}\n{}",
        bundled_runtime.display(),
        development_runtime.display()
    ))
}

// ------------------------------------------------------------
// Resolve legacy project root for development fallback
// ------------------------------------------------------------

fn resolve_project_root() -> Result<PathBuf, String> {
    if let Ok(value) = env::var("SNIP_AI_PROJECT_ROOT") {
        if !value.trim().is_empty() {
            let path = PathBuf::from(value);

            if path.exists() {
                return Ok(path);
            }

            return Err(format!(
                "SNIP_AI_PROJECT_ROOT does not exist:\n{}",
                path.display()
            ));
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    let project_root = manifest_dir
        .parent()
        .ok_or_else(|| {
            "Could not resolve Snip AI project root.".to_string()
        })?;

    Ok(project_root.to_path_buf())
}

// ------------------------------------------------------------
// Resolve Python executable
//
// Bundled runtime:
//   Windows: windows-runtime/python/Scripts/python.exe
//   Linux:   windows-runtime/python/bin/python
//
// Development fallback:
//   clipper/.whisper-venv
// ------------------------------------------------------------

fn resolve_python(
    app: &tauri::AppHandle,
) -> Result<PathBuf, String> {
    let project_root = resolve_project_root()?;

    // --------------------------------------------------------
    // WINDOWS
    // --------------------------------------------------------
    //
    // Windows uses the bundled portable Python runtime.
    //
    if cfg!(target_os = "windows") {
        if let Ok(runtime_root) = resolve_runtime_root(app) {
            let python_dir = runtime_root.join("python");

            let candidates = [
                python_dir.join("python.exe"),
                python_dir.join("Scripts").join("python.exe"),
                python_dir.join("Scripts").join("python"),
            ];

            for candidate in candidates {
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }

    // --------------------------------------------------------
    // DEVELOPMENT / LINUX / MACOS
    // --------------------------------------------------------
    //
    // Linux development uses the project's Whisper virtual
    // environment instead of the Windows runtime directory.
    //
    let venv = project_root
        .join("clipper")
        .join(".whisper-venv");

    let development_venv = project_root
        .join(".venv-whisper");

    let candidates = if cfg!(target_os = "windows") {
        vec![
            development_venv.join("Scripts").join("python.exe"),
            development_venv.join("Scripts").join("python"),
            venv.join("Scripts").join("python.exe"),
            venv.join("Scripts").join("python"),
        ]
    } else {
        vec![
            development_venv.join("bin").join("python"),
            development_venv.join("bin").join("python3"),
            venv.join("bin").join("python"),
            venv.join("bin").join("python3"),
        ]
    };

    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "Whisper Python environment not found.
\
Expected development environment:
{}",
        venv.display()
    ))
}

// ------------------------------------------------------------
// Resolve pipeline runner
//
// Bundled:
//   windows-runtime/pipeline/pipeline_runner.py
//
// Development fallback:
//   project root/pipeline_runner.py
// ------------------------------------------------------------

fn resolve_runner(
    app: &tauri::AppHandle,
) -> Result<PathBuf, String> {
    if let Ok(runtime_root) = resolve_runtime_root(app) {
        let runner = runtime_root
            .join("pipeline")
            .join("pipeline_runner.py");

        if runner.is_file() {
            return Ok(runner);
        }
    }

    let project_root = resolve_project_root()?;

    let candidates = [
        project_root.join("windows-runtime").join("pipeline").join("pipeline_runner.py"),
        project_root.join("pipeline_runner.py"),
    ];

    if let Some(runner) = candidates.iter().find(|path| path.is_file()) {
        return Ok(runner.to_path_buf());
    }

    Err(format!(
        "Pipeline runner not found. Checked:\n{}",
        candidates.iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join("\n")
    ))
}

// ------------------------------------------------------------
// Resolve output directory
// ------------------------------------------------------------

fn resolve_output_dir() -> Result<PathBuf, String> {
    if let Ok(value) = env::var("SNIP_AI_OUTPUT_DIR") {
        if !value.trim().is_empty() {
            return Ok(PathBuf::from(value));
        }
    }

    let home = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .map_err(|_| {
            "Could not determine the user's home directory."
                .to_string()
        })?;

    Ok(PathBuf::from(home)
        .join("Downloads")
        .join("Snip AI Clips"))
}

// ------------------------------------------------------------
// Remove previous generated clips
// ------------------------------------------------------------

fn remove_old_generated_clips(
    output_dir: &Path,
) -> Result<(), String> {
    if !output_dir.exists() {
        return Ok(());
    }

    let entries = fs::read_dir(output_dir)
        .map_err(|error| {
            format!(
                "Could not read output folder:\n{}\n{}",
                output_dir.display(),
                error
            )
        })?;

    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "Could not read output entry:\n{}",
                error
            )
        })?;

        let path = entry.path();

        let is_generated_clip = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| {
                name.starts_with("snip_ai_simple_clip_")
                    && name.ends_with(".mp4")
            })
            .unwrap_or(false);

        if is_generated_clip && path.is_file() {
            fs::remove_file(&path).map_err(|error| {
                format!(
                    "Could not remove old generated clip:\n{}\n{}",
                    path.display(),
                    error
                )
            })?;
        }
    }

    Ok(())
}

// ------------------------------------------------------------
// Validate MP4 using bundled/system ffprobe
// ------------------------------------------------------------

fn validate_mp4(
    app: &tauri::AppHandle,
    path: &Path,
) -> bool {
    if !path.is_file() {
        return false;
    }

    let metadata = match fs::metadata(path) {
        Ok(value) => value,
        Err(_) => return false,
    };

    if metadata.len() == 0 {
        return false;
    }

    let ffprobe = resolve_ffprobe(app);

    let ffprobe_result = Command::new(ffprobe)
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v:0")
        .arg("-show_entries")
        .arg("stream=codec_name,width,height,duration")
        .arg("-of")
        .arg("default=noprint_wrappers=1:nokey=0")
        .arg(path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    match ffprobe_result {
        Ok(status) => status.success(),
        Err(_) => false,
    }
}

// ------------------------------------------------------------
// Resolve bundled FFmpeg
// ------------------------------------------------------------

fn resolve_ffmpeg(
    app: &tauri::AppHandle,
) -> PathBuf {
    if let Ok(runtime_root) = resolve_runtime_root(app) {
        let bundled = runtime_root
            .join("ffmpeg")
            .join(if cfg!(target_os = "windows") {
                "ffmpeg.exe"
            } else {
                "ffmpeg"
            });

        if bundled.is_file() {
            return bundled;
        }
    }

    PathBuf::from(if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    })
}

// ------------------------------------------------------------
// Resolve bundled FFprobe
// ------------------------------------------------------------

fn resolve_ffprobe(
    app: &tauri::AppHandle,
) -> PathBuf {
    if let Ok(runtime_root) = resolve_runtime_root(app) {
        let bundled = runtime_root
            .join("ffmpeg")
            .join(if cfg!(target_os = "windows") {
                "ffprobe.exe"
            } else {
                "ffprobe"
            });

        if bundled.is_file() {
            return bundled;
        }
    }

    PathBuf::from(if cfg!(target_os = "windows") {
        "ffprobe.exe"
    } else {
        "ffprobe"
    })
}

// ------------------------------------------------------------
// Collect and validate generated clips
// ------------------------------------------------------------

fn collect_generated_clips(
    app: &tauri::AppHandle,
    output_dir: &Path,
) -> Result<Vec<String>, String> {
    if !output_dir.exists() {
        return Err(format!(
            "Output folder was not created:\n{}",
            output_dir.display()
        ));
    }

    let entries = fs::read_dir(output_dir)
        .map_err(|error| {
            format!(
                "Could not read output folder:\n{}\n{}",
                output_dir.display(),
                error
            )
        })?;

    let mut output_paths = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "Could not read output entry:\n{}",
                error
            )
        })?;

        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let is_mp4 = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("mp4"))
            .unwrap_or(false);

        let is_snip_clip = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| {
                name.starts_with("snip_ai_simple_clip_")
            })
            .unwrap_or(false);

        if !is_mp4 || !is_snip_clip {
            continue;
        }

        if validate_mp4(app, &path) {
            output_paths.push(
                path.to_string_lossy().to_string()
            );
        } else {
            println!(
                "Ignoring invalid generated MP4: {}",
                path.display()
            );
        }
    }

    output_paths.sort();

    Ok(output_paths)
}

// ------------------------------------------------------------
// YOUTUBE DOWNLOAD
// ------------------------------------------------------------

#[tauri::command]
async fn download_youtube(
    app: tauri::AppHandle,
    url: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || download_youtube_inner(app, url))
        .await
        .map_err(|error| format!("Background YouTube download task failed: {}", error))?
}

fn download_youtube_inner(
    app: tauri::AppHandle,
    url: String,
) -> Result<String, String> {
    println!();
    println!("==============================================");
    println!("SNIP AI â€” YOUTUBE DOWNLOAD");
    println!("==============================================");
    println!("URL: {}", url);

    let url = url.trim();

    if url.is_empty() {
        return Err("YouTube URL cannot be empty.".to_string());
    }

    if !(url.starts_with("https://www.youtube.com/")
        || url.starts_with("https://youtube.com/")
        || url.starts_with("https://m.youtube.com/")
        || url.starts_with("https://youtu.be/"))
    {
        return Err("Please enter a valid YouTube URL.".to_string());
    }

    let python = resolve_python(&app)?;
    let runtime_root = resolve_runtime_root(&app)?;
    let node_runtime = runtime_root.join("node").join(if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    });
    if !node_runtime.is_file() {
        return Err(format!(
            "Bundled Node.js runtime was not found; YouTube's JavaScript challenge solver needs it:\n{}",
            node_runtime.display()
        ));
    }
    let js_runtime = format!("node:{}", node_runtime.display());
    let downloads_root = dirs::download_dir()
        .ok_or_else(|| "Could not find your Downloads folder.".to_string())?
        .join("Snip AI Downloads");
    // Cookies are strictly a fallback: the first attempt always uses no account session.
    let local_cookies = dirs::download_dir().map(|path| path.join("cookies.txt"))
        .filter(|path| path.is_file());
    let download_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Could not create download ID: {}", error))?
        .as_millis();
    let download_dir = downloads_root.join(format!("download-{}", download_id));
    fs::create_dir_all(&download_dir).map_err(|error| {
        format!(
            "Could not create Snip AI Downloads folder:\n{}",
            error
        )
    })?;

    println!("Download folder: {}", download_dir.display());
    let output_template = download_dir.join("%(title).100s-%(id)s.%(ext)s");
    let mut command = Command::new(&python);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    command
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8");

    let _ = app.emit("youtube-download-progress", serde_json::json!({
        "percent": null,
        "downloadedBytes": 0,
        "totalBytes": null,
        "speed": "",
        "eta": "",
        "stage": "Reading video information"
    }));
    let run_attempt = |use_local_cookies: bool| -> Result<(ExitStatus, String, String), String> {
        let mut attempt_command = Command::new(&python);
        #[cfg(target_os = "windows")]
        attempt_command.creation_flags(0x08000000);
        attempt_command
            .env("PYTHONUTF8", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .args(["-m", "yt_dlp", "--js-runtimes"])
            .arg(&js_runtime)
            // The packaged app keeps FFmpeg in its portable runtime directory,
            // which is not on PATH on other computers. Tell yt-dlp explicitly
            // so separate YouTube audio/video streams are merged into one MP4.
            .arg("--ffmpeg-location")
            .arg(resolve_ffmpeg(&app));
        if use_local_cookies {
            if let Some(cookies_path) = local_cookies.as_ref() {
                attempt_command.arg("--cookies").arg(cookies_path);
            }
        }
        attempt_command.args([
            "--no-playlist",
            "--newline",
            "--socket-timeout",
            "20",
            "--retries",
            "2",
            "--fragment-retries",
            "2",
            "--extractor-retries",
            "2",
            "--progress-template",
            "download:SNIP_PROGRESS:%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress._speed_str)s|%(progress._eta_str)s",
            "--print",
            "before_dl:SNIP_VIDEO_INFO:%(title)s|%(thumbnail)s",
            "--concurrent-fragments",
            "8",
            "--format",
            "bv*[height<=1080]+ba/b[height<=1080]/b",
            "--merge-output-format",
            "mp4",
            "--restrict-filenames",
            "--print",
            "after_move:filepath",
            "--output",
        ]);
        let mut child = attempt_command
            .arg(&output_template)
            .arg(url)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Failed to start YouTube downloader:\n{}", error))?;
        let stdout_pipe = child.stdout.take()
            .ok_or_else(|| "Could not read YouTube downloader output.".to_string())?;
        let stderr_pipe = child.stderr.take()
            .ok_or_else(|| "Could not read YouTube download progress.".to_string())?;

        let preview_app = app.clone();
        let stdout_reader = thread::spawn(move || {
            let mut lines = Vec::<String>::new();
            let mut bytes = Vec::new();
            let mut reader = BufReader::new(stdout_pipe);
            loop {
                bytes.clear();
                match reader.read_until(b'\n', &mut bytes) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
                let line = String::from_utf8_lossy(&bytes)
                    .trim_end_matches(|character| character == '\r' || character == '\n')
                    .to_string();
                if let Some(marker) = line.find("SNIP_PROGRESS:") {
                    let fields = line[marker + "SNIP_PROGRESS:".len()..].split('|').collect::<Vec<_>>();
                    if fields.len() >= 6 {
                        let percent = fields[0].trim().trim_end_matches('%').parse::<f64>().ok().map(|v| v.clamp(0.0, 100.0));
                        let downloaded_bytes = fields[1].trim().parse::<u64>().unwrap_or(0);
                        let total_bytes = fields[2].trim().parse::<u64>().ok().filter(|v| *v > 0)
                            .or_else(|| fields[3].trim().parse::<u64>().ok().filter(|v| *v > 0));
                        let speed = fields[4].trim().to_string();
                        let eta = fields[5].trim().to_string();
                        let _ = preview_app.emit("youtube-download-progress", serde_json::json!({
                            "percent": percent, "downloadedBytes": downloaded_bytes, "totalBytes": total_bytes,
                            "speed": speed, "eta": eta, "stage": "Downloading video"
                        }));
                    }
                } else if let Some(payload) = line.strip_prefix("SNIP_VIDEO_INFO:") {
                    if let Some((title, thumbnail)) = payload.split_once('|') {
                        let thumbnail = thumbnail.trim();
                        let is_youtube_thumbnail = thumbnail.starts_with("https://i.ytimg.com/")
                            || thumbnail.starts_with("https://img.youtube.com/")
                            || (thumbnail.starts_with("https://")
                                && thumbnail.split('/').nth(2).is_some_and(|host| host.ends_with(".ytimg.com")));
                        if is_youtube_thumbnail {
                            let _ = preview_app.emit("youtube-download-preview", serde_json::json!({
                                "title": title.trim(), "thumbnail": thumbnail
                            }));
                        }
                    }
                } else if line.to_lowercase().contains("downloading 1 format") {
                    let _ = preview_app.emit("youtube-download-progress", serde_json::json!({
                        "percent": null, "downloadedBytes": 0, "totalBytes": null, "speed": "", "eta": "",
                        "stage": "Starting video transfer"
                    }));
                }
                lines.push(line);
            }
            lines
        });

        let progress_app = app.clone();
        let stderr_reader = thread::spawn(move || {
            let mut lines = Vec::<String>::new();
            let mut bytes = Vec::new();
            let mut reader = BufReader::new(stderr_pipe);
            loop {
                bytes.clear();
                match reader.read_until(b'\n', &mut bytes) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
                let line = String::from_utf8_lossy(&bytes)
                    .trim_end_matches(|character| character == '\r' || character == '\n')
                    .to_string();
                let lower = line.to_lowercase();
                let stage = if lower.contains("merging") || lower.contains("post-process") {
                    Some("Finalizing video")
                } else if lower.contains("downloading webpage") || lower.contains("downloading api") || lower.contains("extracting url") {
                    Some("Reading video information")
                } else {
                    None
                };
                if let Some(stage) = stage {
                    let _ = progress_app.emit("youtube-download-progress", serde_json::json!({
                        "percent": null, "downloadedBytes": 0, "totalBytes": null, "speed": "", "eta": "", "stage": stage
                    }));
                }
                lines.push(line);
            }
            lines
        });
        let status = child.wait().map_err(|error| format!("Could not wait for YouTube downloader: {}", error))?;
        let stdout = stdout_reader.join().map_err(|_| "Could not collect downloader output.".to_string())?.join("\n");
        let stderr = stderr_reader.join().map_err(|_| "Could not collect download progress.".to_string())?.join("\n");
        Ok((status, stdout, stderr))
    };

    let (mut status, mut stdout, mut stderr) = run_attempt(false)?;
    let first_attempt_log = format!("{}\n{}", stdout, stderr).to_lowercase();
    let authentication_required = [
        "sign in to confirm",
        "not a bot",
        "login_required",
        "http error 429",
        "confirm you’re not a bot",
        "confirm you're not a bot",
    ]
    .iter()
    .any(|marker| first_attempt_log.contains(marker));
    let needs_cookie_retry = local_cookies.is_some()
        && !status.success()
        && authentication_required;
    let cookies_retry_attempted = needs_cookie_retry;
    if needs_cookie_retry {
        println!("Anonymous YouTube request requires sign-in; retrying once with local cookies.");
        let _ = app.emit("youtube-download-progress", serde_json::json!({
            "percent": null, "downloadedBytes": 0, "totalBytes": null, "speed": "", "eta": "",
            "stage": "Retrying with local cookies"
        }));
        let (retry_status, retry_stdout, retry_stderr) = run_attempt(true)?;
        status = retry_status;
        stdout = retry_stdout;
        stderr = retry_stderr;
    }
    let _ = app.emit("youtube-download-progress", serde_json::json!({
        "percent": 100.0,
        "downloadedBytes": 0,
        "totalBytes": null,
        "speed": "",
        "eta": "",
        "stage": "Validating video"
    }));
    let mut downloaded_path = None;

    // yt-dlp can report a late HTTP/post-processing error after it has already
    // moved the completed media into place. Trust a file only if FFprobe can
    // read its video stream; the process exit code alone is not sufficient.
    for line in stdout.lines().rev() {
        let candidate = PathBuf::from(line.trim().trim_matches('"'));
        if candidate.is_file() && validate_mp4(&app, &candidate) {
            downloaded_path = Some(candidate);
            break;
        }
    }

    let log_path = download_dir.join(format!(
        "download-{}.log",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default()
    ));
    let full_log = format!("=== stdout ===\n{}\n=== stderr ===\n{}", stdout, stderr);
    let final_attempt_requires_auth = [
        "sign in to confirm",
        "not a bot",
        "login_required",
        "http error 429",
        "confirm you’re not a bot",
        "confirm you're not a bot",
    ]
    .iter()
    .any(|marker| full_log.to_lowercase().contains(marker));
    let log_save_note = fs::write(&log_path, full_log.as_bytes())
        .err()
        .map(|error| format!("\nCould not save download log: {}", error))
        .unwrap_or_default();

    let Some(downloaded_path) = downloaded_path else {
        let tail = full_log
            .chars()
            .rev()
            .take(8_000)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<String>();
        let auth_guidance = if cookies_retry_attempted && final_attempt_requires_auth {
            "YouTube rejected the saved cookies too. Replace Downloads\\cookies.txt with a fresh Netscape export from a browser currently signed in to YouTube, then retry.\n\n"
        } else if cookies_retry_attempted {
            "The automatic retry with Downloads\\cookies.txt did not complete. See the downloader output below for the remaining error.\n\n"
        } else if authentication_required && local_cookies.is_none() {
            "YouTube requires sign-in, but Downloads\\cookies.txt was not found, so no cookie retry was possible.\n\n"
        } else {
            ""
        };
        return Err(format!(
            "{}YouTube download did not produce a valid video ({}). Full log: {}{}\n\nLast downloader output:\n{}",
            auth_guidance,
            status,
            log_path.display(),
            log_save_note,
            tail
        ));
    };

    if !status.success() {
        eprintln!(
            "yt-dlp exited with {} after producing a valid MP4; using the validated file. Full log: {}",
            status,
            log_path.display()
        );
    }

    println!("Downloaded and validated: {}", downloaded_path.display());
    println!("==============================================");
    Ok(downloaded_path.to_string_lossy().to_string())
}

fn resolve_caption_renderer(
    app: &tauri::AppHandle,
) -> Result<PathBuf, String> {
    if let Ok(runtime_root) = resolve_runtime_root(app) {
        let bundled = runtime_root.join("caption-renderer");

        if bundled.join("src").join("render.ts").is_file() {
            return Ok(bundled);
        }
    }

    let project_root = resolve_project_root()?;
    let development = project_root.join("snip-caption-renderer");

    if development.join("src").join("render.ts").is_file() {
        return Ok(development);
    }

    Err(format!(
        "Remotion caption renderer was not found.\\n\\nExpected development path:\\n{}",
        development.display()
    ))
}

// ------------------------------------------------------------
// REAL SNIP AI PIPELINE
// ------------------------------------------------------------

#[tauri::command]
async fn create_clips(
    app: tauri::AppHandle,
    input_path: String,
    format: String,
    requested_clips: u32,
    caption_template: String,
    different_captions: bool,
    audio_language: String,
    caption_overrides: String,
) -> Result<GeneratedClipsResult, String> {
    let _request_guard = begin_pipeline_request()?;
    tauri::async_runtime::spawn_blocking(move || {
        create_clips_inner(
            app,
            input_path,
            format,
            requested_clips,
            caption_template,
            different_captions,
            audio_language,
            caption_overrides,
        )
    })
    .await
    .map_err(|error| format!("Background pipeline task failed: {}", error))?
}

fn create_clips_inner(
    app: tauri::AppHandle,
    input_path: String,
    format: String,
    requested_clips: u32,
    caption_template: String,
    different_captions: bool,
    audio_language: String,
    caption_overrides: String,
) -> Result<GeneratedClipsResult, String> {
    println!();
    println!("==============================================");
    println!("SNIP AI ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â CREATE CLIPS");
    println!("==============================================");
    println!("Input : {}", input_path);
    println!("Format: {}", format);
    println!(
        "Requested clips: {}",
        requested_clips
    );
    println!(
        "Caption template: {}",
        caption_template
    );
    println!(
        "Different captions: {}",
        different_captions
    );

    if audio_language != "english" && audio_language != "hinglish" {
        return Err("Invalid audio language. Choose English or Hinglish.".to_string());
    }
    let caption_overrides = normalize_caption_overrides_json(&caption_overrides)?;
    println!("English transcription model: base");

    if format != "1:1" && format != "9:16" && format != "16:9" {
        return Err(
            "Invalid framing format. Use 1:1 or 9:16."
                .to_string()
        );
    }

    if requested_clips < 1 || requested_clips > 10 {
        return Err(
            "Clip count must be between 1 and 10."
                .to_string()
        );
    }

    let allowed_caption_templates = [
        "pop",
        "karaoke",
        "bold-center",
        "punch",
        "minimal",
        "highlight-box",
        "typewriter",
        "bounce",
        "kinetic",
        "podcast",
        "yellow-stack",
        "violet-pill",
        "dual-line",
        "bold-karaoke",
        "soft-lyric",
    ];

    if !allowed_caption_templates
        .contains(&caption_template.as_str())
    {
        return Err(format!(
            "Invalid caption template: {}",
            caption_template
        ));
    }

    let input = PathBuf::from(&input_path);

    if !input.exists() {
        return Err(format!(
            "Video file not found:\n{}",
            input.display()
        ));
    }

    if !input.is_file() {
        return Err(format!(
            "Input path is not a file:\n{}",
            input.display()
        ));
    }

    let runtime_root =
        resolve_runtime_root(&app)?;

    let python =
        resolve_python(&app)?;

    let runner =
        resolve_runner(&app)?;

    let output_root = resolve_output_dir()?;
    let run_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Could not create render run ID: {}", error))?
        .as_millis();
    let output_dir = output_root.join(format!("run-{}", run_id));



    println!(
        "Runtime root: {}",
        runtime_root.display()
    );

    println!(
        "Python: {}",
        python.display()
    );

    println!(
        "Runner: {}",
        runner.display()
    );

    println!(
        "FFmpeg: {}",
        resolve_ffmpeg(&app).display()
    );

    println!(
        "FFprobe: {}",
        resolve_ffprobe(&app).display()
    );

    println!(
        "Output: {}",
        output_dir.display()
    );

    fs::create_dir_all(&output_dir)
        .map_err(|error| {
            format!(
                "Could not create output directory:\n{}\n{}",
                output_dir.display(),
                error
            )
        })?;

    // Preserve previous runs. Each run uses its own output directory.

    println!();
    println!("Starting Snip AI pipeline...");

    let mut command = Command::new(&python);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);

    let child = command
        .arg(&runner)
        .arg(&input)
        .arg(&format)
        .arg(requested_clips.to_string())
        .arg(&caption_template)
        .arg(if different_captions {
            "true"
        } else {
            "false"
        })
        .arg(&audio_language)
        .env(
            "SNIP_AI_OUTPUT_DIR",
            &output_dir,
        )
        .env(
            "SNIP_AI_WORK_DIR",
            output_dir.join(".snip-ai-work"),
        )
        .env("PYTHONUNBUFFERED", "1")
        .env(
            "SNIP_AI_RUNTIME_ROOT",
            &runtime_root,
        )
        .env(
            "SNIP_AI_PYTHON",
            &python,
        )
        .env(
            "SNIP_AI_FFMPEG",
            resolve_ffmpeg(&app),
        )
        .env(
            "SNIP_AI_FFPROBE",
            resolve_ffprobe(&app),
        )
        .env(
            "SNIP_AI_WHISPER_MODEL_DIR",
            runtime_root.join("whisper-model"),
        )
        .env("SNIP_AI_WHISPER_MODEL", "base")
        .env("SNIP_AI_HINGLISH_ENGINE", "swift")
        .env("SNIP_AI_WHISPER_DEVICE", "cpu")
        .env("SNIP_AI_SWIFT_DEVICE", "cpu")
        .env("SNIP_AI_CAPTION_OVERRIDES_JSON", &caption_overrides)

        .env(
            "SNIP_AI_NODE",
            if cfg!(target_os = "windows") {
                runtime_root
                    .join("node")
                    .join("node.exe")
            } else {
                PathBuf::from("node")
            },
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(
            runner.parent().ok_or_else(|| {
                "Could not resolve pipeline runner directory.".to_string()
            })?,
        )
        .spawn()
        .map_err(|error| {
            format!(
                "Failed to start Snip AI pipeline:\n{}",
                error
            )
        })?;

    let (status, log_path, log_tail) = stream_child_output(
        &app,
        child,
        &output_dir,
        "pipeline.log",
    )?;
    if !status.success() {
        return Err(format!(
            "Snip AI pipeline failed.\nExit status: {}\nFull log: {}\n\nLast process output:\n{}",
            status,
            log_path.display(),
            log_tail
        ));
    }

    let output_paths =
        collect_generated_clips(
            &app,
            &output_dir,
        )?;

    if output_paths.is_empty() {
        return Err(
            "Pipeline completed, but no valid generated clips were found."
                .to_string()
        );
    }

    println!();
    println!("==============================================");
    println!("SNIP AI ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â GENERATED CLIPS");
    println!("==============================================");
    println!("Count: {}", output_paths.len());

    for path in &output_paths {
        println!("{}", path);
    }

    println!("==============================================");
    println!();

    let social_captions = load_social_captions(&output_dir, output_paths.len());
    Ok(GeneratedClipsResult {
        paths: output_paths,
        social_captions,
    })
}

fn load_social_captions(output_dir: &Path, clip_count: usize) -> Vec<String> {
    const FALLBACK: &str = "A standout moment worth sharing.";
    let selected_generation = output_dir
        .join(".snip-ai-work")
        .join("selected-generation.json");
    let clips = fs::read_to_string(selected_generation)
        .ok()
        .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
        .and_then(|data| data.get("clips").and_then(serde_json::Value::as_array).cloned())
        .unwrap_or_default();

    let mut ranked_clips = clips;
    ranked_clips.sort_by_key(|clip| {
        clip.get("generation_rank")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(u64::MAX)
    });

    (0..clip_count)
        .map(|index| {
            let text = ranked_clips
                .get(index)
                .and_then(|clip| clip.get("text"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let cleaned = text.split_whitespace().collect::<Vec<_>>().join(" ");
            let cleaned = cleaned.trim_matches(|character: char| {
                character.is_whitespace() || ",.;:!?-â€“â€”\"'â€œâ€â€˜â€™".contains(character)
            });
            if cleaned.is_empty() {
                return FALLBACK.to_string();
            }
            if cleaned.chars().count() <= 140 {
                return cleaned.to_string();
            }

            let mut shortened = String::new();
            for word in cleaned.split_whitespace() {
                let candidate_length = shortened.chars().count()
                    + usize::from(!shortened.is_empty())
                    + word.chars().count();
                if candidate_length > 137 {
                    break;
                }
                if !shortened.is_empty() {
                    shortened.push(' ');
                }
                shortened.push_str(word);
            }
            if shortened.is_empty() {
                cleaned.chars().take(137).collect::<String>()
            } else {
                format!("{}â€¦", shortened.trim_end_matches(|character: char| ",.;:!?-â€“â€”".contains(character)))
            }
        })
        .collect()
}

// ------------------------------------------------------------
// EXPORT CLIPS
// ------------------------------------------------------------

#[tauri::command]
fn export_clips(
    input_paths: Vec<String>,
    destination_dir: String,
) -> Result<Vec<String>, String> {
    if input_paths.is_empty() {
        return Err(
            "No clips were selected for export.".to_string()
        );
    }

    let destination =
        PathBuf::from(&destination_dir);

    if !destination.exists() {
        fs::create_dir_all(&destination)
            .map_err(|error| {
                format!(
                    "Could not create export folder:\n{}",
                    error
                )
            })?;
    }

    if !destination.is_dir() {
        return Err(
            "Selected export location is not a folder."
                .to_string()
        );
    }

    let mut exported_paths: Vec<String> =
        Vec::new();

    for input_path in input_paths {
        let source =
            PathBuf::from(&input_path);

        if !source.exists() || !source.is_file() {
            return Err(format!(
                "Clip file not found:\n{}",
                source.display()
            ));
        }

        let file_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                format!(
                    "Could not read clip filename:\n{}",
                    source.display()
                )
            })?;

        let target =
            destination.join(file_name);

        fs::copy(&source, &target)
            .map_err(|error| {
                format!(
                    "Could not export clip:\n{}\n{}",
                    source.display(),
                    error
                )
            })?;

        exported_paths.push(
            target.to_string_lossy().to_string()
        );
    }

    println!(
        "SNIP AI ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â EXPORTED {} CLIPS",
        exported_paths.len()
    );

    for path in &exported_paths {
        println!("{}", path);
    }

    Ok(exported_paths)
}

// ------------------------------------------------------------
// TAURI APPLICATION
// ------------------------------------------------------------

// Render an animated caption-only preview using the same FFmpeg caption
// engine as production. Results are cached per template in the app cache.
#[tauri::command]
fn render_caption_preview(
    app: tauri::AppHandle,
    theme: String,
    source_video_path: Option<String>,
    format: Option<String>,
) -> Result<String, String> {
    let allowed = [
        "pop", "karaoke", "bold-center", "punch", "minimal",
        "highlight-box", "typewriter", "bounce", "kinetic", "podcast",
        "yellow-stack", "violet-pill", "dual-line", "bold-karaoke", "soft-lyric",
    ];
    if !allowed.contains(&theme.as_str()) {
        return Err(format!("Invalid caption preview theme: {}", theme));
    }
    let source_video = source_video_path
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from);
    if let Some(path) = &source_video {
        if !path.is_file() {
            return Err(format!("Preview source video was not found: {}", path.display()));
        }
    }
    let format = format.filter(|value| value == "1:1" || value == "9:16" || value == "16:9")
        .unwrap_or_else(|| "1:1".to_string());

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_root = manifest_dir.parent()
        .ok_or_else(|| "Could not resolve project directory.".to_string())?;
    let runtime_root = resolve_runtime_root(&app)?;
    let resource_dir = app.path().resource_dir()
        .map_err(|e| format!("Could not resolve resource directory: {}", e))?;
    let bundled_engine = resource_dir.join("caption-renderer").join("engine.cjs");
    let development_engine = project_root.join("snip-caption-renderer")
        .join("src").join("ffmpeg-captions").join("engine.cjs");
    let engine = if bundled_engine.is_file() {
        bundled_engine
    } else {
        development_engine
    };
    if !engine.is_file() {
        return Err(format!("FFmpeg caption engine not found: {}", engine.display()));
    }

    let bundled_script = runtime_root.join("pipeline").join("render_caption_preview.py");
    let dev_script = project_root.join("windows-runtime").join("pipeline").join("render_caption_preview.py");
    let script = if cfg!(debug_assertions) && dev_script.is_file() {
        dev_script
    } else if bundled_script.is_file() {
        bundled_script
    } else {
        dev_script
    };
    if !script.is_file() {
        return Err(format!("Caption preview script not found: {}", script.display()));
    }

    let cache_dir = app.path().app_cache_dir()
        .map_err(|e| format!("Could not resolve app cache directory: {}", e))?
        .join("caption-previews");
    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Could not create caption preview cache: {}", e))?;

    let mut hasher = DefaultHasher::new();
    theme.hash(&mut hasher);
    format.hash(&mut hasher);
    "snip-caption-preview-ffmpeg-black-v6-lowres".hash(&mut hasher);
    if let Some(path) = &source_video {
        path.to_string_lossy().hash(&mut hasher);
        if let Ok(meta) = fs::metadata(path) {
            meta.len().hash(&mut hasher);
            if let Ok(modified) = meta.modified() {
                if let Ok(age) = modified.duration_since(std::time::UNIX_EPOCH) {
                    age.as_secs().hash(&mut hasher);
                }
            }
        }
    }
    engine.to_string_lossy().hash(&mut hasher);
    if let Ok(meta) = fs::metadata(&engine) {
        meta.len().hash(&mut hasher);
        if let Ok(modified) = meta.modified() {
            if let Ok(age) = modified.duration_since(std::time::UNIX_EPOCH) {
                age.as_secs().hash(&mut hasher);
            }
        }
    }
    let output = cache_dir.join(format!("{:016x}-{}.mp4", hasher.finish(), theme));
    if output.is_file() && fs::metadata(&output).map(|m| m.len() > 1024).unwrap_or(false) {
        return Ok(output.to_string_lossy().to_string());
    }

    let python = runtime_root.join("python").join(if cfg!(target_os = "windows") {
        "python.exe"
    } else {
        "bin/python"
    });
    let ffmpeg = runtime_root.join("ffmpeg").join(if cfg!(target_os = "windows") { "ffmpeg.exe" } else { "ffmpeg" });
    let node = runtime_root.join("node").join(if cfg!(target_os = "windows") { "node.exe" } else { "node" });
    for (name, executable) in [("Python", &python), ("FFmpeg", &ffmpeg), ("Node.js", &node)] {
        if !executable.is_file() {
            return Err(format!("Bundled {} runtime is missing. Reinstall Snip AI. Expected: {}", name, executable.display()));
        }
    }
    let result = Command::new(&python)
        .arg(&script)
        .arg(&theme)
        .arg(&output)
        .arg(source_video.as_ref().map(|path| path.to_string_lossy().to_string()).unwrap_or_default())
        .arg(&format)
        .env("SNIP_AI_CAPTION_ENGINE", &engine)
        .env("SNIP_AI_FFMPEG", &ffmpeg)
        .env("SNIP_AI_NODE", &node)
        .current_dir(std::env::temp_dir())
        .output()
        .map_err(|e| format!("Could not start caption preview renderer ({}): {}", python.display(), e))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let stdout = String::from_utf8_lossy(&result.stdout);
        return Err(format!(
            "Caption preview render failed for '{}'.\n{}\n{}",
            theme, stderr.trim(), stdout.trim()
        ));
    }
    if !output.is_file() || fs::metadata(&output).map(|m| m.len() < 1024).unwrap_or(true) {
        return Err("Caption preview renderer finished without a valid MP4.".to_string());
    }
    Ok(output.to_string_lossy().to_string())
}

#[tauri::command]
async fn get_hardware_profile(
    app: tauri::AppHandle,
    force_detect: bool,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        get_hardware_profile_inner(app, force_detect)
    })
    .await
    .map_err(|error| format!("Hardware detection task failed: {}", error))?
}

fn get_hardware_profile_inner(
    app: tauri::AppHandle,
    force_detect: bool,
) -> Result<serde_json::Value, String> {
    let runtime = resolve_runtime_root(&app)?;
    let python = resolve_python(&app)?;
    let script = runtime.join("pipeline").join("hardware_profile.py");
    if !script.is_file() {
        return Err(format!("Hardware detection script not found: {}", script.display()));
    }
    let mut command = Command::new(&python);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    command
        .arg(&script)
        .env("SNIP_AI_PYTHON", &python)
        .env("SNIP_AI_FFMPEG", resolve_ffmpeg(&app))
        .env("SNIP_AI_RUNTIME_ROOT", &runtime)
        .env("PYTHONUNBUFFERED", "1");
    if force_detect {
        command.arg("--force");
    }
    let output = command
        .output()
        .map_err(|error| format!("Could not detect local hardware: {}", error))?;
    if !output.status.success() {
        let details = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Hardware detection failed: {}", details.trim()));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let profile_json = stdout
        .lines()
        .find_map(|line| line.strip_prefix("SNIP_AI_HARDWARE_PROFILE="))
        .ok_or_else(|| "Hardware detection returned no saved profile.".to_string())?;
    let profile: serde_json::Value = serde_json::from_str(profile_json)
        .map_err(|error| format!("Hardware detection returned invalid data: {}", error))?;
    if profile.get("transcription").and_then(|value| value.get("device")).and_then(serde_json::Value::as_str).is_none()
        || profile.get("video").and_then(|value| value.get("encoder")).and_then(serde_json::Value::as_str).is_none()
    {
        return Err("Hardware detection returned an incomplete profile.".to_string());
    }
    Ok(profile)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_single_instance::init(
                |app, args, _cwd| {
                    println!(
                        "Snip AI received second-instance arguments: {:?}",
                        args
                    );

                    if let Some(url) = args
                        .iter()
                        .find(|arg| {
                            arg.starts_with("snipai://")
                        })
                    {
                        println!(
                            "Snip AI deep-link received: {}",
                            url
                        );

                        if let Some(window) =
                            app.get_webview_window("main")
                        {
                            let _ = window.set_focus();
                        }

                        if url.starts_with(
                            "snipai://payment/",
                        ) {
                            println!(
                                "Snip AI payment deep-link received: {}",
                                url
                            );

                            let _ = app.emit(
                                "snipai://payment/callback",
                                url.clone(),
                            );
                        }
                    }
                },
            ),
        )
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(
            tauri::generate_handler![
                greet,
                download_youtube,
                create_clips,
                cancel_processing,
                export_clips,
                render_caption_preview,
                get_hardware_profile
            ],
        )
        .run(tauri::generate_context!())
        .expect(
            "error while running Tauri application"
        );
}
