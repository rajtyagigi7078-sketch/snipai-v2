import { useEffect, useRef, useState } from "react";
import { loadCapsnipTypographyFonts, paintCapsnipTemplateSample, typographyTheme } from "./editor/capsnipTypography";

type Props = { theme: string; className?: string };

const LOOP_THEMES = new Set([
  "pop", "bold-center", "bounce", "highlight-box", "karaoke", "minimal",
  "podcast", "typewriter", "kinetic", "punch", "yellow-stack", "violet-pill",
  "dual-line", "bold-karaoke", "soft-lyric",
]);

export default function CaptionThemePreview({ theme, className = "" }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const isLoop = LOOP_THEMES.has(theme);
  const isTypography = Boolean(typographyTheme(theme));
  const src = `${import.meta.env.BASE_URL}assets/snip-ai-preview-loops/${theme}.mp4`;

  useEffect(() => {
    const node = hostRef.current;
    if (!node || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "0px", threshold: 0.01 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !visible) return;
    void video.play().catch(() => undefined);
    return () => video.pause();
  }, [visible, theme]);

  useEffect(() => {
    const canvas=canvasRef.current;
    if (!visible || !isTypography || !canvas) return;
    let cancelled=false,frame=0,last=0;const start=performance.now();
    const paint=(now=performance.now())=>{if(cancelled)return;if(now-last>=33){last=now;paintCapsnipTemplateSample(canvas,theme,(now-start)/1000)}frame=requestAnimationFrame(paint)};
    void loadCapsnipTypographyFonts().catch(error=>console.error("Capsnip font failed to load",error)).then(()=>{if(!cancelled)paint()});
    return()=>{cancelled=true;cancelAnimationFrame(frame)};
  }, [visible,isTypography,theme]);

  return (
    <div ref={hostRef} style={{minHeight:140}} className={`caption-engine-preview ${className}`} data-theme={theme} aria-label={`${theme} Capsnip caption preview`}>
      {theme === 'none' ? <div style={{display:'grid',placeContent:'center',height:'100%',color:'#d9d7ed',textAlign:'center'}}><strong style={{fontSize:24}}>None</strong><small>No captions · clean video</small></div> : visible && isTypography ? (
        <canvas ref={canvasRef} width="960" height="540" className="caption-engine-preview-video" aria-label={`${theme} live canvas preview`} />
      ) : visible && isLoop ? (
        <video ref={videoRef} className="caption-engine-preview-video" src={src} muted loop autoPlay playsInline preload="none" />
      ) : visible ? (
        <div className="caption-engine-preview-copy" data-preview-theme={theme}>
          <span className="caption-preview-word caption-preview-word-1">THIS</span>
          <span className="caption-preview-word caption-preview-word-2">IS</span>
          <span className="caption-preview-word caption-preview-word-3">SNIP</span>
          <span className="caption-preview-word caption-preview-word-4">AI</span>
        </div>
      ) : null}
    </div>
  );
}
