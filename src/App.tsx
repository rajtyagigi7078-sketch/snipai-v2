import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

import {
  ArrowLeft,
  ArrowRight,
  BadgeDollarSign,
  Captions,
  Check,
  Clapperboard,
  Clock3,
  ChevronDown,
  Copy,
  Cpu,
  ExternalLink,
  FileVideo,
  Film,
  FolderOpen,
  History as HistoryIcon,
  LayoutTemplate,
  Link2,
  LoaderCircle,
  Play,
  RotateCcw,
  Scissors,
  Settings,
  ShieldCheck,
  Sparkles,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";

import LicenseActivation from "./LicenseActivation";
import "./NextTheme.css";
import "./Redesign.css";
import "./Version14Workspace.css";

const CaptionThemePreview = lazy(() => import("./CaptionThemePreview"));

type Format = "1:1" | "16:9";

const CAPTION_STYLES = [
  { name: "pop", label: "Pop", description: "Word-by-word pop with a quick scale-up." },
  { name: "bold-center", label: "Bold Center", description: "One bold word at a time, centered and static." },
  { name: "bounce", label: "Steady Highlight", description: "Pink active-word highlight with a soft fade; captions stay anchored." },
  { name: "highlight-box", label: "Teal Highlight Box", description: "White active word on a deep teal highlight." },
  { name: "karaoke", label: "Karaoke", description: "League Spartan; each spoken word instantly fills with electric cyan." },
  { name: "minimal", label: "Minimal Fade", description: "One clean word at a time with a gentle fade and no position changes." },
  { name: "podcast", label: "Podcast", description: "A fixed dark word panel; yellow color follows the spoken word without movement." },
  { name: "typewriter", label: "Typewriter", description: "Retro condensed Teko lettering revealed character by character." },
  { name: "kinetic", label: "Kinetic", description: "Oswald two-line groups with steady cyan word highlighting and no vertical movement." },
  { name: "punch", label: "Punch", description: "Comic-book stamp motion, directional slide, and alternating neon red/yellow words." },
  { name: "yellow-stack", label: "Sunny Stack", description: "Bold yellow two-line captions, like your first reference." },
  { name: "violet-pill", label: "Violet Pill", description: "White words with a violet active-word pill." },
  { name: "dual-line", label: "Dual-Line Lyric", description: "A bold gold line followed by the next line in a softer contrasting style." },
  { name: "bold-karaoke", label: "Reel Karaoke", description: "Compact uppercase captions; the yellow active word fades in without popping." },
  { name: "soft-lyric", label: "Soft Lyric", description: "Smaller centered lyrics with a gentle fade and no bouncing." },
] as const;

type CaptionThemeName =
  (typeof CAPTION_STYLES)[number]["name"];

function isCaptionThemeName(value: string): value is CaptionThemeName {
  return CAPTION_STYLES.some((item) => item.name === value);
}

function AudioLanguagePicker({
  value,
  onChange,
}: {
  value: "english" | "hinglish";
  onChange: (value: "english" | "hinglish") => void;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const label = value === "hinglish" ? "Hinglish (Hindi + English)" : "English";

  return (
    <div
      className={`language-detection-note audio-language-picker ${open ? "is-open" : ""}`}
      ref={pickerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          pickerRef.current?.querySelector<HTMLButtonElement>(".audio-language-trigger")?.focus();
        }
      }}
    >
      <span className="audio-language-label">Audio language</span>
      <button
        type="button"
        className="audio-language-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="audio-language-menu" role="menu" aria-label="Choose audio language">
          {([
            ["hinglish", "Hinglish (Hindi + English)"],
            ["english", "English"],
          ] as const).map(([option, optionLabel]) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={value === option}
              className={`audio-language-option ${value === option ? "selected" : ""}`}
              onClick={() => {
                onChange(option);
                setOpen(false);
                pickerRef.current?.querySelector<HTMLButtonElement>(".audio-language-trigger")?.focus();
              }}
            >
              <span>{optionLabel}</span>
              {value === option && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const processingStages = [
  {
    title: "Preparing video",
    description: "Getting your video ready for processing",
    icon: FileVideo,
  },
  {
    title: "Analyzing content",
    description: "Preparing the source video",
    icon: WandSparkles,
  },
  {
    title: "Finding best moments",
    description: "Selecting initial clip positions",
    icon: Sparkles,
  },
  {
    title: "Creating clips",
    description: "Rendering your clips with FFmpeg",
    icon: Scissors,
  },
  {
    title: "Applying captions",
    description: "Preparing your selected caption style",
    icon: Captions,
  },
  {
    title: "Finalizing",
    description: "Preparing your clips for export",
    icon: Check,
  },
];

function getFileName(path: string) {
  return (
    path.split("/").pop()?.split("\\").pop() ||
    "Selected video"
  );
}

type LocalVideoPreviewProps = {
  path: string;
  index: number;
  onPlay: () => void;
  onPause: () => void;
};

function LocalVideoPreview({
  path,
  index,
  onPlay,
  onPause,
}: LocalVideoPreviewProps) {
  const [blobUrl, setBlobUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError("");
    setBlobUrl("");
    try {
      // Stream from Tauri's asset protocol directly. Fetching the entire clip
      // as a Blob failed for some local output paths and duplicated memory use.
      setBlobUrl(convertFileSrc(path));
      setLoading(false);
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Unable to load preview.");
    }
  }, [path, index, retry]);

  if (loading) {
    return (
      <div className="clip-video-loading">
        <div className="clip-video-loading-spinner" />
        <span>Loading previewÃ¢â‚¬Â¦</span>
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div className="clip-video-error">
        <div className="clip-video-error-icon">
          <FileVideo size={20} />
        </div>

        <strong>Preview couldn't load</strong>

        <span>{error || "Video preview unavailable."}</span>

        <button
          type="button"
          className="clip-video-retry"
          onClick={(event) => {
            event.stopPropagation();
            setRetry((value) => value + 1);
          }}
        >
          Retry preview
        </button>
      </div>
    );
  }

  return (
    <video
      key={blobUrl}
      src={blobUrl}
      autoPlay
      loop
      muted
      preload="auto"
      playsInline
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;

        console.log(
          `[Snip AI] Clip ${index + 1} ready`,
          {
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
          },
        );
      }}
      onCanPlay={() => {
        console.log(
          `[Snip AI] Clip ${index + 1} can play`,
        );
      }}
      onError={(event) => {
        const video = event.currentTarget;

        console.error(
          `[Snip AI] Clip ${index + 1} playback error`,
          {
            code: video.error?.code,
            message: video.error?.message,
          },
        );
        setError(video.error?.message || "Could not stream this local video.");
      }}
      onPlay={onPlay}
      onPause={onPause}
      onEnded={onPause}
    />
  );
}

const downloadAnimationStyle = `
@keyframes snipDownloadPulse {
  0% { transform: translateX(-180%); opacity: 0.35; }
  50% { transform: translateX(120%); opacity: 1; }
  100% { transform: translateX(280%); opacity: 0.35; }
}
`;


type WorkspacePage = "auto-clipping" | "history" | "settings";
type GenerationRecord = {
  id: string;
  createdAt: string;
  videoName: string;
  format: Format;
  template: string;
  clipCount: number;
  paths: string[];
  socialCaptions?: string[];
  kind?: "clips" | "caption";
};

type GeneratedClipsResult = {
  paths: string[];
  social_captions: string[];
};

type HardwareProfile = {
  version: number;
  transcription: {
    device: "gpu" | "cuda" | "cpu";
    faster_whisper_device?: "cuda" | "cpu";
    swift_device?: "dml" | "webgpu" | "cpu";
  };
  video: { mode: string; encoder: string };
};

function transcriptionHardwareLabel(profile: HardwareProfile): string {
  const legacyDevice = profile.transcription.device === "cuda" ? "cuda" : "cpu";
  const swift = (profile.transcription.swift_device ?? legacyDevice).toUpperCase();
  const whisper = (profile.transcription.faster_whisper_device ?? legacyDevice).toUpperCase();
  return `Hinglish ${swift} · English ${whisper}`;
}

const HISTORY_STORAGE_KEY = "snip-ai-generation-history-v1";
const SETTINGS_STORAGE_KEY = "snip-ai-settings-v1";

function readStoredHistory(): GenerationRecord[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatHistoryDate(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function HistoryPage({
  history,
  onOpenRecord,
  onOpenFolder,
  onClear,
}: {
  history: GenerationRecord[];
  onOpenRecord: (record: GenerationRecord) => void;
  onOpenFolder: (paths: string[]) => void;
  onClear: () => void;
}) {
  return (
    <section className="workspace-page">
      <div className="page-header-row">
        <div>
          <p className="eyebrow">HISTORY</p>
          <h1>Generation history.</h1>
          <p className="subtitle">A local record of the clip sets you have generated in Snip AI.</p>
        </div>
        {history.length > 0 && <button type="button" className="danger-page-button" onClick={onClear}>Clear history</button>}
      </div>

      {history.length === 0 ? (
        <div className="page-empty-state">
          <div className="page-empty-icon"><HistoryIcon size={24} /></div>
          <h2>No generation history</h2>
          <p>Your completed generations will appear here automatically.</p>
        </div>
      ) : (
        <div className="history-list">
          {history.map((record, index) => (
            <article className="history-row" key={record.id}>
              <div className="history-index">{String(index + 1).padStart(2, "0")}</div>
              <div className="history-main">
                <strong>{record.videoName || "Untitled video"}</strong>
                 <span>{formatHistoryDate(record.createdAt)} Ã‚Â· {record.clipCount} clips Ã‚Â· {record.format} Ã‚Â· {record.template}</span>
              </div>
              <div className="history-actions">
                <button type="button" className="secondary-page-button" onClick={() => onOpenRecord(record)}><Play size={14} /> Preview</button>
                <button type="button" className="ghost-page-button" onClick={() => onOpenFolder(record.paths)}><FolderOpen size={14} /></button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SettingsPage({
  defaultFormat,
  setDefaultFormat,
  defaultClipCount,
  setDefaultClipCount,
  welcomeTitle,
  setWelcomeTitle,
  welcomeSubtitle,
  setWelcomeSubtitle,
  onPreviewWelcome,
  hardwareProfile,
  hardwareProfileLoading,
  hardwareProfileError,
  onRedetectHardware,
  onReset,
}: {
  defaultFormat: Format;
  setDefaultFormat: (value: Format) => void;
  defaultClipCount: number;
  setDefaultClipCount: (value: number) => void;
  welcomeTitle: string;
  setWelcomeTitle: (value: string) => void;
  welcomeSubtitle: string;
  setWelcomeSubtitle: (value: string) => void;
  onPreviewWelcome: () => void;
  hardwareProfile: HardwareProfile | null;
  hardwareProfileLoading: boolean;
  hardwareProfileError: string;
  onRedetectHardware: () => void;
  onReset: () => void;
}) {
  return (
    <section className="workspace-page settings-page">
      <div className="page-header-row">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>Snip AI settings.</h1>
          <p className="subtitle">Choose the defaults used when you start a new generation. Changes are saved on this computer.</p>
        </div>
        <div className="page-header-badge"><ShieldCheck size={15} /> Local settings</div>
      </div>

      <div className="settings-grid">
        <div className="settings-card">
          <div className="settings-card-title"><div className="settings-card-icon"><Film size={17} /></div><div><strong>Generation defaults</strong><span>Starting values for Create.</span></div></div>
          <label className="settings-label">Default video format</label>
          <div className="settings-choice-row">
            {(["1:1", "16:9"] as Format[]).map((item) => <button type="button" key={item} className={`settings-choice ${defaultFormat === item ? "selected" : ""}`} onClick={() => setDefaultFormat(item)}>{item}</button>)}
          </div>

          <label className="settings-label">Default clip count <strong>{defaultClipCount}</strong></label>
          <input className="settings-range" type="range" min="1" max="10" value={defaultClipCount} onChange={(event) => setDefaultClipCount(Number(event.target.value))} />

          <div className="settings-switch-row">
            <div className="settings-info-note">
              <LayoutTemplate size={16} />
              <div>
                <strong>FFmpeg caption styles</strong>
                <span>The selected caption theme is used consistently for generated clips.</span>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-card hardware-settings-card">
          <div className="settings-card-title"><div className="settings-card-icon"><Cpu size={17} /></div><div><strong>Hardware profile</strong><span>Saved for future processing on this computer.</span></div></div>
          <div className={`hardware-profile-status ${hardwareProfileError ? "has-error" : ""}`} role="status" aria-live="polite">
            <span className="hardware-profile-dot" />
            <div>
              <strong>{hardwareProfileLoading ? "Checking this computerâ€¦" : hardwareProfileError ? "Hardware check needs attention" : hardwareProfile ? `${transcriptionHardwareLabel(hardwareProfile)} Â· ${hardwareProfile.video.encoder}` : "Hardware profile not available"}</strong>
              <span>{hardwareProfileError || (hardwareProfile ? "English and Hinglish transcription run locally on CPU. No CUDA installation is required." : "Snip AI will retry detection before processing.")}</span>
            </div>
          </div>
          <button type="button" className="hardware-redetect-button" onClick={onRedetectHardware} disabled={hardwareProfileLoading}>
            {hardwareProfileLoading ? <LoaderCircle size={14} className="button-spinner" /> : <RotateCcw size={14} />}
            {hardwareProfileLoading ? "Checkingâ€¦" : "Re-detect hardware"}
          </button>
        </div>

        <div className="settings-card welcome-settings-card">
          <div className="settings-card-title"><div className="settings-card-icon"><Sparkles size={17} /></div><div><strong>Welcome message</strong><span>The app opens straight into video selection. Preview your message here.</span></div></div>

          <label className="settings-label">Main message</label>
          <input className="welcome-settings-input" value={welcomeTitle} maxLength={42} onChange={(event) => setWelcomeTitle(event.target.value)} placeholder="Welcome to Snip AI" />

          <label className="settings-label">Today's plan line</label>
          <input className="welcome-settings-input" value={welcomeSubtitle} maxLength={70} onChange={(event) => setWelcomeSubtitle(event.target.value)} placeholder="Ready to create your next clips?" />

          <div className="welcome-settings-preview">
            <span>PREVIEW</span>
            <strong>{welcomeTitle || "Welcome to Snip AI"}</strong>
            <p>{welcomeSubtitle || "Ready to create your next clips?"}</p>
          </div>
          <button type="button" className="hardware-redetect-button" onClick={onPreviewWelcome}><Play size={14} />Preview welcome screen</button>
        </div>

        <div className="settings-card">
          <div className="settings-card-title"><div className="settings-card-icon"><FolderOpen size={17} /></div><div><strong>Storage</strong><span>Where Snip AI keeps generated files.</span></div></div>
          <div className="storage-path-box"><span>Generated clips</span><strong>~/Downloads/Snip AI Clips</strong><small>Output location is managed by the local Tauri backend.</small></div>
          <div className="storage-path-box"><span>Downloaded YouTube videos</span><strong>~/Downloads/Snip AI Downloads</strong><small>Downloaded source videos stay on this computer.</small></div>
        </div>
      </div>

      <LicenseActivation />

      <div className="settings-footer"><span><ShieldCheck size={14} /> Settings are stored locally on this device.</span><button type="button" className="ghost-page-button" onClick={onReset}>Reset defaults</button></div>
    </section>
  );
}

function App() {
  const [hardwareProfile, setHardwareProfile] = useState<HardwareProfile | null>(null);
  const [hardwareProfileLoading, setHardwareProfileLoading] = useState(true);
  const [hardwareProfileError, setHardwareProfileError] = useState("");

  const refreshHardwareProfile = useCallback(async (forceDetect: boolean) => {
    setHardwareProfileLoading(true);
    setHardwareProfileError("");
    try {
      const profile = await invoke<HardwareProfile>("get_hardware_profile", { forceDetect });
      setHardwareProfile(profile);
    } catch (error) {
      setHardwareProfileError(typeof error === "string" ? error : "Could not read the saved hardware profile.");
    } finally {
      setHardwareProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshHardwareProfile(false);
  }, [refreshHardwareProfile]);

  const [format, setFormat] = useState<Format>(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      return raw && ["9:16", "16:9"].includes(JSON.parse(raw).defaultFormat) ? "16:9" : "1:1";
    } catch {
      return "1:1";
    }
  });
  const [template, setTemplate] = useState<CaptionThemeName>("pop");
  const [audioLanguage, setAudioLanguage] = useState<"english" | "hinglish">("hinglish");
  const [differentCaptions] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      return raw ? JSON.parse(raw).defaultDifferentCaptions !== false : true;
    } catch {
      return true;
    }
  });

  const [dragging, setDragging] = useState(false);
  const [youtubeLink, setYoutubeLink] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadPreview, setDownloadPreview] = useState<{ title: string; thumbnail: string } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{
    percent: number | null;
    downloadedBytes: number;
    totalBytes: number | null;
    speed: string;
    eta: string;
    stage: string;
  }>({ percent: null, downloadedBytes: 0, totalBytes: null, speed: "", eta: "", stage: "Connecting to YouTube" });
  const downloadInFlightRef = useRef(false);
  const [videoName, setVideoName] = useState("");
  const [videoPath, setVideoPath] = useState("");
  const [youtubeVideoSelected, setYoutubeVideoSelected] = useState(false);
  const videoPathRef = useRef("");

  useEffect(() => {
    let active = true;
    let unlistenProgress: (() => void) | undefined;
    let unlistenPreview: (() => void) | undefined;
    void listen<{
      percent: number | null;
      downloadedBytes: number;
      totalBytes: number | null;
      speed: string;
      eta: string;
      stage: string;
    }>("youtube-download-progress", (event) => {
      if (!active) return;
      const p = event.payload;
      setDownloadProgress({
        percent: typeof p.percent === "number" ? Math.max(0, Math.min(100, p.percent)) : null,
        downloadedBytes: Number(p.downloadedBytes) || 0,
        totalBytes: typeof p.totalBytes === "number" ? p.totalBytes : null,
        speed: p.speed || "",
        eta: p.eta || "",
        stage: p.stage || "Downloading video"
      });
    }).then((stop) => {
      if (active) unlistenProgress = stop;
      else stop();
    });
    void listen<{ title: string; thumbnail: string }>("youtube-download-preview", (event) => {
      if (!active) return;
      const title = event.payload.title?.trim();
      const thumbnail = event.payload.thumbnail?.trim();
      if (title && thumbnail) setDownloadPreview({ title, thumbnail });
    }).then((stop) => {
      if (active) unlistenPreview = stop;
      else stop();
    });
    return () => { active = false; unlistenProgress?.(); unlistenPreview?.(); };
  }, []);


  const [isProcessing, setIsProcessing] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const cancelRequestedRef = useRef(false);
  const [requestedClips, setRequestedClips] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      const value = Number(raw ? JSON.parse(raw).defaultClipCount : 5);
      return Number.isFinite(value) ? Math.min(10, Math.max(1, value)) : 5;
    } catch {
      return 5;
    }
  });
  const [processingProgress, setProcessingProgress] =
    useState(0);
  const [processingStage, setProcessingStage] = useState(0);
  const [processingDetail, setProcessingDetail] = useState("");

  const [processingComplete, setProcessingComplete] =
    useState(false);

  const [outputPaths, setOutputPaths] = useState<string[]>(
    [],
  );
  const [outputSocialCaptions, setOutputSocialCaptions] = useState<string[]>([]);
  const [copiedCaptionIndex, setCopiedCaptionIndex] = useState<number | null>(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [showGallery, setShowGallery] = useState(false);
  const [outputKind, setOutputKind] = useState<"clips" | "caption">("clips");
  const activeProcessingStages = processingStages;
  const [playingClip, setPlayingClip] = useState<number | null>(
    null,
  );

  const [selectedClips, setSelectedClips] = useState<Set<number>>(
    new Set(),
  );

  const [isExporting, setIsExporting] = useState(false);

  // ----------------------------------------------------------
  const [workspacePage, setWorkspacePage] = useState<WorkspacePage>("auto-clipping");
  const [historyRecords, setHistoryRecords] = useState<GenerationRecord[]>(() => readStoredHistory());
  const [defaultFormat, setDefaultFormat] = useState<Format>(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      return raw && ["9:16", "16:9"].includes(JSON.parse(raw).defaultFormat) ? "16:9" : "1:1";
    } catch {
      return "1:1";
    }
  });
  const [defaultClipCount, setDefaultClipCount] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      const value = Number(raw ? JSON.parse(raw).defaultClipCount : 5);
      return Number.isFinite(value) ? Math.min(10, Math.max(1, value)) : 5;
    } catch {
      return 5;
    }
  });
  const [welcomeTitle, setWelcomeTitle] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      const value = raw ? JSON.parse(raw).welcomeTitle : "";
      return typeof value === "string" && value.trim() ? value : "Welcome to Snip AI";
    } catch {
      return "Welcome to Snip AI";
    }
  });

  const [welcomeSubtitle, setWelcomeSubtitle] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      const value = raw ? JSON.parse(raw).welcomeSubtitle : "";
      return typeof value === "string" && value.trim() ? value : "Ready to create your next clips?";
    } catch {
      return "Ready to create your next clips?";
    }
  });

  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>("pipeline-progress", (event) => {
      const message = event.payload.trim();
      if (!message) return;
      setProcessingDetail(message);
      const normalized = message.toLowerCase();
      if (normalized.includes("whisper") || normalized.includes("transcrib") || normalized.includes("swift")) {
        setProcessingStage(1);
      } else if (normalized.includes("moment") || normalized.includes("analyz")) {
        setProcessingStage(2);
      } else if (normalized.includes("render") || normalized.includes("clip")) {
        setProcessingStage(3);
      } else if (normalized.includes("caption")) {
        setProcessingStage(4);
      }
    }).then((stop) => { unlisten = stop; });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(historyRecords.slice(0, 30)));
    } catch (error) {
      console.warn("Could not save Snip AI history:", error);
    }
  }, [historyRecords]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
        defaultFormat,
        defaultClipCount,
        welcomeTitle,
        welcomeSubtitle,
      }));
    } catch (error) {
      console.warn("Could not save Snip AI settings:", error);
    }
  }, [defaultFormat, defaultClipCount, welcomeTitle, welcomeSubtitle]);

  const selectedTemplate =
    CAPTION_STYLES.find(
      (item) => item.name === template,
    ) ?? CAPTION_STYLES[0];

  // ----------------------------------------------------------
  const navigateTo = (page: WorkspacePage) => {
    if (isProcessing) return;
    setShowGallery(false);
    setProcessingComplete(false);
    setWorkspacePage(page);
    setPlayingClip(null);
  };

  const openHistoryRecord = (record: GenerationRecord) => {
    if (!record.paths.length) return;
    setOutputPaths(record.paths);
    setOutputSocialCaptions(record.socialCaptions ?? []);
    setVideoName(record.videoName);
    setFormat(record.format);
    setTemplate(
      isCaptionThemeName(record.template)
        ? record.template
        : "pop",
    );
    setOutputKind(record.kind === "caption" ? "caption" : "clips");
    setWorkspacePage("auto-clipping");
    setShowGallery(true);
    setProcessingComplete(false);
    setPlayingClip(null);
    setSelectedClips(new Set(record.paths.map((_, index) => index)));
  };

  const copySocialCaption = async (index: number) => {
    const caption = outputSocialCaptions[index];
    if (!caption) return;
    try {
      await navigator.clipboard.writeText(caption);
      setCopiedCaptionIndex(index);
      window.setTimeout(() => setCopiedCaptionIndex((current) => current === index ? null : current), 1600);
    } catch (error) {
      console.error("Could not copy clip caption:", error);
    }
  };

  const openHistoryFolder = async (paths: string[]) => {
    if (!paths.length) return;
    try {
      const firstPath = paths[0];
      const lastSlash = Math.max(firstPath.lastIndexOf("/"), firstPath.lastIndexOf("\\"));
      const folderPath = lastSlash > 0 ? firstPath.substring(0, lastSlash) : firstPath;
      await openPath(folderPath);
    } catch (error) {
      console.error("Could not open history folder:", error);
    }
  };

  const clearHistory = () => {
    setHistoryRecords([]);
  };

  const selectVideo = (path: string, downloadedFromYoutube = false) => {
    if (!path) {
      return;
    }

    setVideoName(getFileName(path));
    setYoutubeVideoSelected(downloadedFromYoutube);
    videoPathRef.current = path;
    setVideoPath(path);
    setYoutubeLink("");
    setProcessingComplete(false);
    setOutputPaths([]);
    setErrorMessage("");
    setProcessingProgress(0);
    setProcessingStage(0);
    setShowGallery(false);
    setPlayingClip(null);
    setSelectedClips(new Set());
  };

  const handleBrowse = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Choose a video",
        filters: [
          {
            name: "Video",
            extensions: [
              "mp4",
              "mov",
              "mkv",
              "webm",
              "avi",
              "m4v",
              "flv",
            ],
          },
        ],
      });

      if (typeof selected === "string") {
        selectVideo(selected);
      }
    } catch (error) {
      console.error("File picker error:", error);
      window.alert("Could not open the video picker.");
    }
  };

  const handleDrop = (
    event: React.DragEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    setDragging(false);

    const file = event.dataTransfer.files?.[0];

    if (!file) {
      return;
    }

    const tauriFile = file as File & {
      path?: string;
    };

    if (tauriFile.path) {
      selectVideo(tauriFile.path);
      return;
    }

    window.alert(
      "Drag & drop could not read the local file path. Please use Browse file.",
    );
  };

  const handleYoutubeLink = async () => {
    const link = youtubeLink.trim();

    if (!link || isDownloading || downloadInFlightRef.current) {
      return;
    }

    if (
      !link.startsWith("https://www.youtube.com/") &&
      !link.startsWith("https://youtube.com/") &&
      !link.startsWith("https://m.youtube.com/") &&
      !link.startsWith("https://youtu.be/")
    ) {
      setErrorMessage("Please enter a valid YouTube URL.");
      return;
    }

    setErrorMessage("");
    setProcessingComplete(false);
    setOutputPaths([]);
    setProcessingProgress(0);
    setProcessingStage(0);
    setShowGallery(false);
    setPlayingClip(null);
    setSelectedClips(new Set());
    downloadInFlightRef.current = true;
    setIsDownloading(true);
    setDownloadPreview(null);
    setDownloadProgress({ percent: null, downloadedBytes: 0, totalBytes: null, speed: "", eta: "", stage: "Connecting to YouTube" });
    setVideoName("Preparing YouTube download…");
    videoPathRef.current = "";
    setVideoPath("");

    // Give React/Tauri time to paint the downloading state before
    // starting the native yt-dlp process.
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 120);
    });

    try {
      const downloadedPath = await invoke<string>("download_youtube", {
        url: link,
      });

      if (!downloadedPath) {
        throw new Error("YouTube download finished without returning a file.");
      }

      selectVideo(downloadedPath, true);
    } catch (error) {
      console.error("[Snip AI] YouTube download error:", error);

      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Could not download the YouTube video.";

      setVideoName("");
      setYoutubeVideoSelected(false);
      videoPathRef.current = "";
      setVideoPath("");
      setErrorMessage(message);
    } finally {
      downloadInFlightRef.current = false;
      setIsDownloading(false);
      setDownloadProgress({ percent: null, downloadedBytes: 0, totalBytes: null, speed: "", eta: "", stage: "Ready" });
    }
  };

  const resetVideo = () => {
    setIsDownloading(false);
    setFormat(defaultFormat);
    setRequestedClips(defaultClipCount);
    setWorkspacePage("auto-clipping");
    setVideoName("");
    setYoutubeVideoSelected(false);
    videoPathRef.current = "";
    setVideoPath("");
    setYoutubeLink("");
    setDownloadPreview(null);
    setProcessingComplete(false);
    setOutputPaths([]);
    setErrorMessage("");
    setProcessingProgress(0);
    setProcessingStage(0);
    setShowGallery(false);
    setPlayingClip(null);
  };

  const startProcessing = async () => {
  setOutputKind("clips");
  if (isDownloading || downloadInFlightRef.current) {
    return;
  }

  const selectedInputPath = videoPathRef.current;
  if (!selectedInputPath) {
    window.alert(
      "Please select a local video file or paste a YouTube link first.",
    );
    return;
  }

  setErrorMessage("");
  cancelRequestedRef.current = false;
  setIsCanceling(false);
  setProcessingDetail("");
  setProcessingComplete(false);
  setOutputPaths([]);
  setShowGallery(false);
  setPlayingClip(null);
  setIsProcessing(true);

  try {
    // --------------------------------------------------------
    // EXISTING SNIP AI PROCESSING PIPELINE
    // --------------------------------------------------------

    setIsProcessing(true);

    setProcessingStage(0);
    setProcessingProgress(8);

    await new Promise((resolve) =>
      setTimeout(resolve, 300),
    );

    setProcessingStage(1);
    setProcessingProgress(20);

    await new Promise((resolve) =>
      setTimeout(resolve, 300),
    );

    setProcessingStage(2);
    setProcessingProgress(35);

    await new Promise((resolve) =>
      setTimeout(resolve, 300),
    );

    setProcessingStage(3);
    setProcessingProgress(50);

    const result = await invoke<GeneratedClipsResult>(
      "create_clips",
      {
        inputPath: selectedInputPath,
        format,
        requestedClips,
        captionTemplate: template,
        differentCaptions,
        audioLanguage,
        captionOverrides: "{}",
      },
    );

    if (!result?.paths?.length) {
      throw new Error(
        "The pipeline finished without generating any valid clips.",
      );
    }

    setOutputKind("clips");
    setOutputPaths(result.paths);
    setSelectedClips(new Set(result.paths.map((_, index) => index)));
    setOutputSocialCaptions(result.social_captions ?? []);

    setProcessingStage(4);
    setProcessingProgress(82);

    await new Promise((resolve) =>
      setTimeout(resolve, 400),
    );

    setProcessingStage(5);
    setProcessingProgress(96);

    await new Promise((resolve) =>
      setTimeout(resolve, 400),
    );

    setProcessingProgress(100);

    setHistoryRecords((previous) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        videoName: videoName || "Untitled video",
        format,
        template,
        clipCount: result.paths.length,
        paths: result.paths,
        socialCaptions: result.social_captions ?? [],
        kind: "clips" as const,
      },
      ...previous.filter(
        (item) =>
          item.paths.join("|") !== result.paths.join("|"),
      ),
    ].slice(0, 30));

    await new Promise((resolve) =>
      setTimeout(resolve, 500),
    );

    setIsProcessing(false);
    setProcessingComplete(true);
  } catch (error) {
    if (cancelRequestedRef.current) {
      setIsProcessing(false);
      setIsCanceling(false);
      setProcessingProgress(0);
      setProcessingStage(0);
      setProcessingDetail("Processing canceled.");
      cancelRequestedRef.current = false;
      return;
    }
    console.error(
      "Clip generation error:",
      error,
    );

    const message =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "Something went wrong while generating the clips.";

    setErrorMessage(message);
    setIsProcessing(false);
    setProcessingProgress(0);
    setProcessingStage(0);
  }
};;

  const cancelCurrentProcessing = async () => {
    if (isCanceling) return;
    cancelRequestedRef.current = true;
    setIsCanceling(true);
    setProcessingDetail("Stopping the current jobâ€¦");
    try {
      await invoke("cancel_processing");
    } catch (error) {
      const message = typeof error === "string" ? error : error instanceof Error ? error.message : "Could not stop the current job.";
      setErrorMessage(message);
      cancelRequestedRef.current = false;
      setIsCanceling(false);
    }
  };

  const openClipsFolder = async () => {
    if (outputPaths.length === 0) {
      return;
    }

    try {
      const firstPath = outputPaths[0];

      const lastSlash = Math.max(
        firstPath.lastIndexOf("/"),
        firstPath.lastIndexOf("\\"),
      );

      const folderPath =
        lastSlash > 0
          ? firstPath.substring(0, lastSlash)
          : firstPath;

      await openPath(folderPath);
    } catch (error) {
      console.error(
        "Could not open clips folder:",
        error,
      );
    }
  };

  const openGallery = () => {
    if (outputPaths.length === 0) {
      return;
    }

    setProcessingComplete(false);
    setShowGallery(true);
    setPlayingClip(null);
    setSelectedClips(
      new Set(outputPaths.map((_, index) => index)),
    );
  };

  const closeGallery = () => {
    setShowGallery(false);
    setPlayingClip(null);
  };

  const toggleClipSelection = (index: number) => {
    setSelectedClips((previous) => {
      const next = new Set(previous);

      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }

      return next;
    });
  };

  const selectAllClips = () => {
    setSelectedClips(
      new Set(outputPaths.map((_, index) => index)),
    );
  };

  const clearClipSelection = () => {
    setSelectedClips(new Set());
  };

  const exportSelectedClips = async () => {
    const selectedPaths = outputPaths.filter((_, index) =>
      selectedClips.has(index),
    );

    if (selectedPaths.length === 0) {
      return;
    }

    try {
      setIsExporting(true);

      const destination = await open({
        directory: true,
        multiple: false,
        title: "Choose export folder",
      });

      if (typeof destination !== "string" || !destination) {
        return;
      }

      await invoke("export_clips", {
        inputPaths: selectedPaths,
        destinationDir: destination,
      });

      window.alert(
        `${selectedPaths.length} clip${
          selectedPaths.length === 1 ? "" : "s"
        } exported successfully.`,
      );
    } catch (error) {
      console.error("Clip export error:", error);

      window.alert(
        "Could not export the selected clips.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleVideoPlay = (index: number) => {
    setPlayingClip(index);
  };

  const handleVideoPause = () => {
    setPlayingClip(null);
  };

  const createAnother = () => {
    resetVideo();
  };

  return (
    <>
      <style>{downloadAnimationStyle}</style>
      <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src="/snip-logo-mark.png" alt="" />
          </div>

          <span className="brand-wordmark">Snip <b>AI</b></span>
        </div>

        <div className="sidebar-section">
          <p className="section-label">
            WORKSPACE
          </p>

          <button type="button" className={`nav-item ${workspacePage === "auto-clipping" ? "active" : ""}`} onClick={() => navigateTo("auto-clipping")}>
            <Clapperboard size={18} /><span>Auto Clipping</span>
          </button>

          <button type="button" className={`nav-item ${workspacePage === "history" ? "active" : ""}`} onClick={() => navigateTo("history")}>
            <HistoryIcon size={18} />
            <span>History</span>
          </button>
        </div>

        <div className="sidebar-bottom">
          <button type="button" className={`nav-item ${workspacePage === "settings" ? "active" : ""}`} onClick={() => navigateTo("settings")}>
            <Settings size={18} />
            <span>Settings</span>
          </button>

        </div>
      </aside>

      <main className="main-content">
        {showGallery ? (
          <section className="gallery-view">
            <header className="gallery-header">
              <div>
                <button
                  className="gallery-back-button"
                  onClick={closeGallery}
                >
                  <ArrowLeft size={16} />
                  Back to create
                </button>

                <p className="eyebrow gallery-eyebrow">
                  OUTPUT
                </p>

                <h1>{outputKind === "caption" ? "Your captioned video is ready." : "Your clips are ready."}</h1>

                <p className="subtitle">
                  Preview your generated {outputKind === "caption" ? "video" : "clips"} directly inside Snip AI.
                </p>
              </div>

              <div className="gallery-header-actions">
                <button
                  type="button"
                  className="gallery-header-action-button gallery-header-export"
                  onClick={exportSelectedClips}
                  disabled={
                    selectedClips.size === 0 ||
                    isExporting
                  }
                >
                  {isExporting ? (
                    <>
                      <LoaderCircle
                        size={14}
                        className="button-spinner"
                      />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <ExternalLink size={14} />
                      Export all
                    </>
                  )}
                </button>

                <button
                  type="button"
                  className="gallery-header-action-button gallery-header-generate"
                  onClick={createAnother}
                >
                  <Sparkles size={14} />
                  Generate another
                </button>

                <div className="gallery-count">
                  <Film size={15} />
                  {outputKind === "caption" ? "1 captioned video" : `${outputPaths.length} clips`}
                </div>

                <button
                  className="gallery-select-button"
                  onClick={selectAllClips}
                  disabled={
                    selectedClips.size ===
                    outputPaths.length
                  }
                >
                  <Check size={14} />
                  Select all
                </button>

                <button
                  className="gallery-clear-button"
                  onClick={clearClipSelection}
                  disabled={
                    selectedClips.size === 0
                  }
                >
                  Clear
                </button>

                <button
                  className="folder-action-button"
                  onClick={openClipsFolder}
                >
                  <FolderOpen size={15} />
                  Open folder
                </button>
              </div>
            </header>

            <div className="gallery-grid">
              {outputPaths.map(
                (path, index) => {
                  return (
                    <article
                      className={`clip-card ${
                        playingClip === index
                          ? "playing"
                          : ""
                      } ${
                        selectedClips.has(index)
                          ? "selected"
                          : ""
                      }`}
                      key={path}
                    >
                      <div className="clip-preview">
                        <LocalVideoPreview
                          path={path}
                          index={index}
                          onPlay={() =>
                            handleVideoPlay(index)
                          }
                          onPause={() =>
                            handleVideoPause()
                          }
                        />

                        <button
                          type="button"
                          className={`clip-select-control ${
                            selectedClips.has(index)
                              ? "selected"
                              : ""
                          }`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleClipSelection(index);
                          }}
                          aria-label={`${
                            selectedClips.has(index)
                              ? "Deselect"
                              : "Select"
                          } clip ${index + 1}`}
                          title={
                            selectedClips.has(index)
                              ? "Deselect clip"
                              : "Select clip"
                          }
                        >
                          {selectedClips.has(index) && (
                            <Check size={12} />
                          )}
                        </button>

                        <div className="clip-number">
                          CLIP{" "}
                          {String(index + 1).padStart(
                            2,
                            "0",
                          )}
                        </div>

                      </div>

                      <div className="clip-card-footer">
                        <div className="clip-card-footer-content">
                          {outputKind === "clips" && outputSocialCaptions[index] && (
                            <div className="clip-social-caption">
                              <p title={outputSocialCaptions[index]}>{outputSocialCaptions[index]}</p>
                              <button
                                type="button"
                                className={`clip-copy-caption-button ${copiedCaptionIndex === index ? "copied" : ""}`}
                                onClick={() => void copySocialCaption(index)}
                                aria-label={copiedCaptionIndex === index ? "Caption copied" : `Copy caption for clip ${index + 1}`}
                                title={copiedCaptionIndex === index ? "Copied" : "Copy caption"}
                              >
                                {copiedCaptionIndex === index ? <Check size={13} /> : <Copy size={13} />}
                              </button>
                            </div>
                          )}

                          <div className="clip-card-footer-meta">
                            <span>{selectedTemplate.name}</span>
                          </div>
                        </div>

                        <button
                          className="clip-folder-button"
                          onClick={
                            openClipsFolder
                          }
                          title="Open output folder"
                        >
                          <ExternalLink
                            size={14}
                          />
                        </button>
                      </div>
                    </article>
                  );
                },
              )}
            </div>

            <div className="gallery-export-bar">
              <div className="gallery-export-info">
                <div className="gallery-export-icon">
                  <Film size={17} />
                </div>

                <div>
                  <strong>
                    {selectedClips.size ===
                    outputPaths.length
                      ? "All clips selected"
                      : `${selectedClips.size} clip${
                          selectedClips.size === 1
                            ? ""
                            : "s"
                        } selected`}
                  </strong>

                  <span>
                    Choose where to save your generated clips
                  </span>
                </div>
              </div>

              <div className="gallery-export-actions">
                <button
                  className="gallery-export-clear"
                  onClick={clearClipSelection}
                  disabled={
                    selectedClips.size === 0 ||
                    isExporting
                  }
                >
                  Clear selection
                </button>

                <button
                  className="gallery-export-button"
                  onClick={exportSelectedClips}
                  disabled={
                    selectedClips.size === 0 ||
                    isExporting
                  }
                >
                  {isExporting ? (
                    <>
                      <LoaderCircle
                        size={16}
                        className="button-spinner"
                      />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <ExternalLink size={16} />
                      {selectedClips.size ===
                      outputPaths.length
                        ? "Export all"
                        : `Export ${selectedClips.size} selected`}
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>
        ) : (workspacePage === "auto-clipping" ? (
          <>
            <header className="topbar">
              <div>
                <p className="eyebrow">
                  AUTO CLIPPING
                </p>

                <h1>
                  {videoPath ? "Set up your clips." : "Paste a link. Make clips worth sharing."}
                </h1>

                <p className="subtitle">
                  {videoPath
                    ? "Choose a frame and caption style, then create short clips from your video."
                    : "Snip AI finds shareable moments in your video. Paste a YouTube link or upload an MP4 to get started."}
                </p>
              </div>

              <div className="topbar-actions">
                <button
                  className="icon-button"
                  aria-label="notifications"
                >
                  <span className="notification-dot" />
                  <Clock3 size={18} />
                </button>

                <div className="secure-badge">
                  <ShieldCheck size={15} />
                  Local processing
                </div>
              </div>
            </header>

            <section className={`workspace auto-clipping-workspace ${videoPath ? "video-loaded" : "video-empty"}`}>
              <div
                className={`drop-zone ${
                  dragging ? "dragging" : ""
                } ${
                  videoName ? "has-video" : ""
                } ${
                  isDownloading ? "is-downloading" : ""
                }`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() =>
                  setDragging(false)
                }
                onDrop={handleDrop}
              >
                <div className="drop-icon">
                  {isDownloading ? (
                    <LoaderCircle
                      size={23}
                      className="button-spinner"
                    />
                  ) : videoName ? (
                    <Check size={23} />
                  ) : (
                    <Upload size={23} />
                  )}
                </div>

                <h2>
                  {isDownloading
                     ? "Preparing YouTube download…"
                    : videoName
                      ? (youtubeVideoSelected ? "Downloaded · selected" : "Video ready")
                      : "Drop your video here"}
                </h2>

                <p>
                  {isDownloading
                     ? "Fetching your video from YouTube. Please wait…"
                    : videoName
                      ? videoName
                      : "Drag & drop a video file, or paste a YouTube link"}
                </p>

                {!videoName && (
                  <div className="upload-inline-row">
                    <div className="youtube-input-wrap">
                      {isDownloading ? (
                        <LoaderCircle size={15} className="button-spinner" />
                      ) : (
                        <Link2 size={15} />
                      )}
                      <input
                        type="text"
                        value={youtubeLink}
                        onChange={(event) => setYoutubeLink(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void handleYoutubeLink();
                        }}
                        placeholder={isDownloading ? "Preparing YouTube download…" : "Paste a YouTube link and press Enter"}
                        aria-label="Paste a YouTube link and press Enter to start"
                        disabled={isDownloading}
                      />
                    </div>
                    <span className="upload-or-label">or</span>
                    <button
                      type="button"
                      className="primary-small upload-inline-button"
                      onClick={handleBrowse}
                      disabled={isDownloading}
                    >
                      <FolderOpen size={15} />
                      Upload files
                    </button>
                  </div>
                )}


                {!videoName && !isDownloading && errorMessage && (
                  <div className="youtube-download-error" role="alert">
                    <strong>Video download failed</strong>
                    {downloadPreview && (
                      <div className="youtube-download-preview">
                        <img
                          src={downloadPreview.thumbnail}
                          alt={`Video thumbnail: ${downloadPreview.title}`}
                          onError={(event) => { event.currentTarget.hidden = true; }}
                        />
                        <div>
                          <span>Requested video</span>
                          <strong title={downloadPreview.title}>{downloadPreview.title}</strong>
                        </div>
                      </div>
                    )}
                    <span>
                      {errorMessage.includes("YouTube rejected the saved cookies too")
                        ? "The saved cookie session was tried but YouTube did not accept it. Replace Downloads/cookies.txt with a fresh export from a browser signed in to YouTube."
                        : errorMessage.includes("automatic retry with Downloads")
                        ? "Snip AI retried with your local cookies, but the download still failed. See technical details for the exact reason."
                        : /could not copy .*cookie database|failed to decrypt with dpapi|could not read .*cookie/i.test(errorMessage)
                        ? "yt-dlp could not read Downloads/cookies.txt. Replace it with a fresh Netscape cookie export and retry."
                        : errorMessage.includes("429") || /not a bot|sign in to confirm/i.test(errorMessage)
                        ? "YouTube is rate-limiting this request or requiring sign-in. Wait a while and retry, or download the video in your browser and choose the local file."
                        : "The link could not be downloaded. Check it and try again."}
                    </span>
                    <details>
                      <summary>Technical details</summary>
                      <pre>{errorMessage}</pre>
                    </details>
                  </div>
                )}

                {videoName && !isDownloading && (
                  <button
                    className="change-video-button"
                    onClick={resetVideo}
                  >
                    Choose another video
                  </button>
                )}

                {videoPath && youtubeVideoSelected && downloadPreview?.thumbnail && (
                  <img
                    className="youtube-selected-thumbnail"
                    src={downloadPreview.thumbnail}
                    alt={`Thumbnail for ${downloadPreview.title}`}
                    title={downloadPreview.title}
                    onError={(event) => { event.currentTarget.hidden = true; }}
                  />
                )}

                {isDownloading && (
                  <div
                    className="youtube-download-status"
                    style={{
                      width: "100%",
                      maxWidth: "430px",
                      margin: "14px auto 0",
                      padding: "12px 14px",
                      border: "1px solid rgba(245, 158, 11, 0.22)",
                      borderRadius: "10px",
                      background: "rgba(245, 158, 11, 0.04)",
                      textAlign: "left",
                      boxSizing: "border-box",
                    }}
                  >
                    {downloadPreview && (
                      <div className="youtube-download-preview">
                        <img
                          src={downloadPreview.thumbnail}
                          alt={`Video thumbnail: ${downloadPreview.title}`}
                          onError={(event) => { event.currentTarget.hidden = true; }}
                        />
                        <div>
                          <span>Downloading this video</span>
                          <strong title={downloadPreview.title}>{downloadPreview.title}</strong>
                        </div>
                      </div>
                    )}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "9px",
                        fontSize: "12px",
                        fontWeight: 600,
                      }}
                    >
                      <LoaderCircle
                        size={14}
                        className="button-spinner"
                      />
                      <span>{downloadProgress.stage}</span>
                    </div>

                    <div
                      style={{
                        marginTop: "9px",
                        height: "4px",
                        overflow: "hidden",
                        borderRadius: "999px",
                        background: "rgba(255,255,255,0.08)",
                      }}
                    >
                      <div
                        className="youtube-download-progress-fill"
                        style={{
                          width: `${downloadProgress.percent ?? 0}%`,
                        }}
                      />
                    </div>

                    <span
                      style={{
                        display: "block",
                        marginTop: "7px",
                        fontSize: "10px",
                        color: "rgba(255,255,255,0.46)",
                      }}
                    >
                      {downloadProgress.percent != null ? `${Math.round(downloadProgress.percent)}% complete` : "Preparing download · video transfer has not started yet"}
                      {downloadProgress.downloadedBytes > 0 && (
                        <span style={{ display: "block", marginTop: "5px", fontSize: "10px", color: "rgba(255,255,255,0.58)" }}>
                          {(downloadProgress.downloadedBytes / 1048576).toFixed(1)} MB
                          {downloadProgress.totalBytes ? ` / ${(downloadProgress.totalBytes / 1048576).toFixed(1)} MB` : ""}
                          {downloadProgress.speed && !["NA", "N/A"].includes(downloadProgress.speed.toUpperCase()) ? ` · ${downloadProgress.speed}` : ""}
                          {downloadProgress.percent != null && downloadProgress.percent < 100
                            ? downloadProgress.eta && !["NA", "N/A"].includes(downloadProgress.eta.toUpperCase())
                              ? ` · ETA ${downloadProgress.eta}`
                              : " · ETA calculating…"
                            : ""}
                        </span>
                      )}
                    </span>
                  </div>
                )}

                <div className="upload-note">
                  Processing happens locally
                  on your computer
                </div>
              </div>

              {!videoPath && !isDownloading && (
                <div className="source-empty-state" aria-label="Animation showing one video becoming ten clips and earning opportunities">
                  <div className="clip-flow-graphic" aria-hidden="true">
                    <div className="flow-source-card"><Film size={27} strokeWidth={2.1} /><b>1 VIDEO</b><span className="flow-card-line" /><span className="flow-card-line short" /></div>
                    <div className="flow-motion-trail"><i /><i /><i /></div>
                    <ArrowRight className="flow-arrow" size={26} strokeWidth={2.1} />
                    <div className="flow-clip-grid">{Array.from({ length: 10 }, (_, index) => <span key={index} style={{ animationDelay: `${index * 85}ms` }}><Play size={9} fill="currentColor" /></span>)}</div>
                    <div className="flow-motion-trail"><i /><i /><i /></div>
                    <ArrowRight className="flow-arrow flow-arrow-last" size={26} strokeWidth={2.1} />
                    <div className="flow-earn-card"><BadgeDollarSign size={27} strokeWidth={2.1} /><b>10 CLIPS</b><span>MORE CHANCES TO EARN</span></div>
                    <span className="flow-sparkle flow-sparkle-one">âœ¦</span><span className="flow-sparkle flow-sparkle-two">âœ¦</span>
                  </div>
                  <strong>1 video. 10 clips. More chances to earn.</strong>
                  <span>Turn one upload into shareable moments for your social channels.</span>
                </div>
              )}

              {videoPath && <>
              <div className="options-grid">
                <div className="option-card">
                  <div className="option-heading">
                    <div>
                      <span className="option-title">
                        Video format
                      </span>

                      <span className="option-description">
                        Choose your final frame
                      </span>
                    </div>
                  </div>

                  <div className="format-options">
                    {(
                      ["1:1", "16:9"] as Format[]
                    ).map((item) => (
                      <button
                        key={item}
                        type="button"
                        aria-pressed={format === item}
                        className={`format-button ${
                          format === item
                            ? "selected"
                            : ""
                        }`}
                        onClick={() =>
                          setFormat(item)
                        }
                      >
                        <div
                          className={`format-preview format-${item.replace(
                            ":",
                            "-",
                          )}`}
                        >
                          <span />
                        </div>

                        <span>{item}</span>
                        {format === item && <Check className="format-selected-check" size={14} strokeWidth={2.7} aria-label="Selected" />}
                      </button>
                    ))}
                  </div>
                  <AudioLanguagePicker value={audioLanguage} onChange={setAudioLanguage} />
                  <div className={`generation-hardware-status ${hardwareProfileError ? "has-error" : ""}`} role="status" aria-live="polite">
                    <Cpu size={15} />
                    <div>
                      <strong>{hardwareProfileLoading ? "Checking hardware…" : hardwareProfileError ? "Hardware profile unavailable" : hardwareProfile ? `${transcriptionHardwareLabel(hardwareProfile)} · ${hardwareProfile.video.encoder}` : "Hardware profile unavailable"}</strong>
                      <span>{hardwareProfileLoading ? "Detecting this computer" : hardwareProfileError ? "Will retry before processing" : "CPU processing · bundled runtime"}</span>
                    </div>
                  </div>
                </div>
                <div className="option-card caption-card remotion-caption-card">
                  <div className="option-heading">
                    <div>
                      <span className="option-title">Captions</span>
                      <span className="option-description">Scroll and select a caption style</span>
                    </div>
                    <div className="selected-template-name">{selectedTemplate.label}</div>
                  </div>
                  <div className="remotion-create-template-carousel">
                    <div className="remotion-create-template-track">
                      {CAPTION_STYLES.map((item) => (
                        <button
                          key={item.name}
                          type="button"
                          className={`remotion-create-template-card ${template === item.name ? "selected" : ""}`}
                          onClick={() => setTemplate(item.name as CaptionThemeName)}
                        >
                          <div className="remotion-create-template-preview">
                            <Suspense fallback={<span className="caption-preview-loading" />}>
                              <CaptionThemePreview theme={item.name} />
                            </Suspense>
                          </div>
                          <div className="remotion-create-template-footer">
                            <span>{item.label}</span>
                            {template === item.name && <span className="template-check"><Check size={10} /></span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {errorMessage && videoPath && (
                <div className="processing-error">
                  <strong>
                    Processing failed
                  </strong>
                  <span>{errorMessage}</span>
                </div>
              )}

              <div className="generation-controls-footer">
              <div className="clip-count-selector">
                <div className="clip-count-header">
                  <div>
                    <strong>Number of clips</strong>
                    <span>Choose how many AI clips to generate</span>
                  </div>

                  <div className="clip-count-value">
                    {requestedClips}
                  </div>
                </div>

                <div className="clip-count-options">
                  {Array.from(
                    { length: 10 },
                    (_, index) => {
                      const count = index + 1;

                      return (
                        <button
                          key={count}
                          type="button"
                          className={
                            requestedClips === count
                              ? "clip-count-button active"
                              : "clip-count-button"
                          }
                          onClick={() =>
                            setRequestedClips(count)
                          }
                          disabled={isProcessing}
                        >
                          {count}
                        </button>
                      );
                    },
                  )}
                </div>
              </div>

              <div className="generate-row">
                <div className="generation-info">
                  <div className="mini-icon">
                    <Sparkles size={15} />
                  </div>

                  <div>
                    <strong>
                      Up to 10 clips
                    </strong>
                    <span>
                      AI-selected moments
                    </span>
                  </div>
                </div>

                <button
                  className="generate-button"
                  onClick={startProcessing}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <>
                      <LoaderCircle
                        size={18}
                        className="button-spinner"
                      />
                      Processing
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      Generate clips
                    </>
                  )}
                </button>
              </div>
              </div>
              </>}
            </section>

            {videoPath && <div className="bottom-hint">
              <Play size={13} />
              Your original video stays on
              your computer.
            </div>}
          </>
        ) : workspacePage === "history" ? (
          <HistoryPage
            history={historyRecords}
            onOpenRecord={openHistoryRecord}
            onOpenFolder={openHistoryFolder}
            onClear={clearHistory}
          />
        ) : workspacePage === "settings" ? (
          <SettingsPage
            defaultFormat={defaultFormat}
            setDefaultFormat={setDefaultFormat}
            defaultClipCount={defaultClipCount}
            setDefaultClipCount={setDefaultClipCount}
            welcomeTitle={welcomeTitle}
            setWelcomeTitle={setWelcomeTitle}
            welcomeSubtitle={welcomeSubtitle}
            setWelcomeSubtitle={setWelcomeSubtitle}
            onPreviewWelcome={() => setShowWelcome(true)}
            hardwareProfile={hardwareProfile}
            hardwareProfileLoading={hardwareProfileLoading}
            hardwareProfileError={hardwareProfileError}
            onRedetectHardware={() => void refreshHardwareProfile(true)}
            onReset={() => {
              setDefaultFormat("1:1");
              setDefaultClipCount(5);
              setWelcomeTitle("Welcome to Snip AI");
              setWelcomeSubtitle("Ready to create your next clips?");
            }}
          />
        ) : null)}

        {isProcessing && (
          <div className="processing-overlay">
            <div className="processing-panel">
              <div className="processing-top">
                <div className="processing-logo">
                  <Sparkles size={21} />
                </div>

                <div className="processing-heading">
                  <span>SNIP AI</span>

                  <h2>
                    Creating your clips
                  </h2>

                  <p>
                    Snip AI is processing your
                    video locally on your
                    computer.
                  </p>
                </div>

                <div className="processing-percent">
                  {processingProgress}%
                </div>


              </div>

              <div className="processing-progress">
                <div
                  className="processing-progress-fill"
                  style={{
                    width: `${processingProgress}%`,
                  }}
                />
              </div>

              <div className="processing-current">
                <div className="processing-current-icon">
                  {(() => {
                    const Icon =
                      activeProcessingStages[
                        Math.min(processingStage, activeProcessingStages.length - 1)
                      ].icon;

                    return <Icon size={19} />;
                  })()}
                </div>

                <div>
                  <strong>
                    {
                      activeProcessingStages[
                        Math.min(processingStage, activeProcessingStages.length - 1)
                      ].title
                    }
                  </strong>

                  <span>
                    {processingDetail ||
                      activeProcessingStages[
                        Math.min(processingStage, activeProcessingStages.length - 1)
                      ].description
                    }
                  </span>
                </div>

                <LoaderCircle
                  size={17}
                  className="stage-spinner"
                />
              </div>

              <div className="processing-stages">
                {activeProcessingStages.map(
                  (stage, index) => {
                    const StageIcon =
                      stage.icon;

                    const completed =
                      index <
                      processingStage;

                    const active =
                      index ===
                      processingStage;

                    return (
                      <div
                        className={`processing-stage ${
                          completed
                            ? "completed"
                            : ""
                        } ${
                          active
                            ? "active"
                            : ""
                        }`}
                        key={stage.title}
                      >
                        <div className="stage-icon">
                          {completed ? (
                            <Check size={13} />
                          ) : (
                            <StageIcon
                              size={13}
                            />
                          )}
                        </div>

                        <span>
                          {stage.title}
                        </span>

                        {index !==
                          activeProcessingStages.length -
                            1 && (
                          <div className="stage-line" />
                        )}
                      </div>
                    );
                  },
                )}
              </div>

              <div className="processing-stop-row">
                <button
                  className="processing-cancel"
                  onClick={cancelCurrentProcessing}
                  disabled={isCanceling}
                  aria-label={isCanceling ? "Stopping processing" : "Stop generation"}
                >
                  <X size={13} /> {isCanceling ? "Stopping…" : "Stop"}
                </button>
              </div>
              <div className="processing-footer">
                <span>
                  <ShieldCheck size={13} />
                  Processing locally on your
                  computer
                </span>

                <span>{videoName}</span>
              </div>
            </div>
          </div>
        )}

        {processingComplete && (
          <div className="processing-overlay complete-overlay">
            <div className="complete-panel">
              <div className="complete-icon">
                <Check size={30} />
              </div>

              <span className="complete-eyebrow">
                ALL DONE
              </span>

              <h2>
                {outputKind === "caption" ? "Your captioned video is ready." : "Your clips are ready."}
              </h2>

              <p>
                {outputKind === "caption" ? "The complete video has been captioned." : <>Snip AI generated <strong>{outputPaths.length}</strong> real clip{outputPaths.length === 1 ? "" : "s"} in <strong>{format}</strong> format.</>}
              </p>

              <div className="complete-stats">
                <div>
                  <strong>
                    {outputPaths.length}
                  </strong>
                  <span>
                    {outputKind === "caption" ? "captioned video" : "clips generated"}
                  </span>
                </div>

                <div>
                  <strong>{outputKind === "caption" ? "Full video" : format}</strong>
                  <span>{outputKind === "caption" ? "original aspect preserved" : "video format"}</span>
                </div>

                <div>
                  <strong>
                    {selectedTemplate.name}
                  </strong>
                  <span>caption style</span>
                </div>
              </div>

              <div className="output-path-box">
                <span>Saved locally</span>

                <strong>
                  {outputKind === "caption" ? "Your full-length captioned video is ready to preview." : "Your generated clips are ready to preview."}
                </strong>
              </div>

              <div className="complete-actions">
                <button
                  className="secondary-complete-button"
                  onClick={createAnother}
                >
                  <RotateCcw size={16} />
                  Create another
                </button>

                <button
                  className="primary-complete-button"
                  onClick={openGallery}
                  disabled={
                    outputPaths.length === 0
                  }
                >
                  <Play size={16} />
                  {outputKind === "caption" ? "Preview video" : "Preview clips"}
                </button>
              </div>
            </div>
          </div>
        )}

        {showWelcome && (
          <div className="welcome-overlay" role="dialog" aria-modal="true" aria-label="Welcome to Snip AI">
            <div className="welcome-backdrop" />
            <div className="welcome-glow welcome-glow-one" />
            <div className="welcome-glow welcome-glow-two" />
            <div className="welcome-modal">
              <div className="welcome-modal-icon"><Sparkles size={22} /></div>
              <span className="welcome-modal-eyebrow">SNIP AI</span>
              <h2>{welcomeTitle || "Welcome to Snip AI"}</h2>
              <p>{welcomeSubtitle || "Ready to create your next clips?"}</p>
              <button type="button" className="welcome-continue-button" onClick={() => setShowWelcome(false)}>
                Let's create
              </button>
            </div>
          </div>
        )}
      </main>
      </div>
    </>
  );
}

export default App;
