import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

type Props = {
  theme: string;
  className?: string;
};

const previewCache = new Map<string, Promise<string>>();
let previewQueue: Promise<void> = Promise.resolve();

const PREVIEW_FORMAT = "1:1" as const;

function getRenderedPreview(theme: string): Promise<string> {
  const key = `${PREVIEW_FORMAT}\u0000${theme}`;
  const cached = previewCache.get(key);
  if (cached) return cached;

  const result = previewQueue.then(() =>
    invoke<string>("render_caption_preview", {
      theme,
      sourceVideoPath: null,
      format: PREVIEW_FORMAT,
    })
  );

  previewQueue = result.then(
    () => undefined,
    () => undefined
  );

  previewCache.set(key, result);
  void result.catch(() => previewCache.delete(key));
  return result;
}

export default function CaptionThemePreview({
  theme,
  className = "",
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [isVisible, setIsVisible] = useState(false);
  const [renderedPath, setRenderedPath] = useState("");
  const [renderError, setRenderError] = useState("");

  useEffect(() => {
    const node = hostRef.current;

    if (!node || typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(Boolean(entry?.isIntersecting)),
      { rootMargin: "80px", threshold: 0.01 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    let cancelled = false;

    setRenderedPath("");
    setRenderError("");

    void getRenderedPreview(theme)
      .then((path) => {
        if (!cancelled) setRenderedPath(path);
      })
      .catch((error: unknown) => {
        console.error("FFmpeg caption preview render failed:", theme, error);
        if (!cancelled) {
          setRenderError(
            error instanceof Error ? error.message : String(error)
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isVisible, theme]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !renderedPath || !isVisible) return;

    let cancelled = false;

    const startPlayback = () => {
      if (cancelled) return;

      void video.play().catch((error: unknown) => {
        console.warn("Caption preview autoplay was blocked:", theme, error);
      });
    };

    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      startPlayback();
    } else {
      video.addEventListener("canplay", startPlayback);
    }

    return () => {
      cancelled = true;
      video.removeEventListener("canplay", startPlayback);
      video.pause();
    };
  }, [renderedPath, isVisible, theme]);

  return (
    <div
      ref={hostRef}
      className={`caption-engine-preview ${className}`}
      data-theme={theme}
      aria-label={`${theme} FFmpeg caption preview`}
    >
      {renderedPath && !renderError ? (
        <video
          ref={videoRef}
          key={renderedPath}
          className="caption-engine-preview-video"
          src={convertFileSrc(renderedPath)}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onError={() => {
            const video = videoRef.current;
            const details = video
              ? `Media error code ${video.error?.code ?? "unknown"}`
              : "Video element unavailable";

            console.error("Caption preview video failed:", theme, details);
            setRenderError(details);
          }}
        />
      ) : (
        <div
          className="caption-engine-preview-copy"
          role="status"
          title={renderError || undefined}
        >
          {renderError
            ? "Preview failed — check console"
            : "Preparing FFmpeg caption preview…"}
        </div>
      )}
    </div>
  );
}
