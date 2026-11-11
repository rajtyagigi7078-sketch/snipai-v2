import { useEffect, useMemo, useRef, useState, type PointerEvent, type CSSProperties } from "react";
import { convertFileSrc, invoke, open } from "../lib/desktop";
import { DEFAULT_EDITOR_OVERLAYS, type EditorOverlayState, type Position } from "./editorModel";
import { ON_SCREEN_TEXT_THEMES, OnScreenTextPreview } from "./OnScreenTextPreview";
import { CAPSNIP_TYPOGRAPHY_THEMES, drawCapsnipCaption, loadCapsnipTypographyFonts, typographyTheme } from "./capsnipTypography";
import "./ClipEditor.css";
import {ColorPill,RulerSlider} from "./EditorControls";
import {ChevronDown,Plus,Trash2} from "lucide-react";

type Word = { text: string; start: number; end: number };
type LineGroup = { id: string; words: Word[]; start: number; end: number };
type ClipData = { sourcePath: string; duration: number; width: number; height: number; words: Word[]; lineGroups?: LineGroup[]; settings?: EditorOverlayState; theme?: string };
type Selection = "captions" | "logo" | string;
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
function initialSettings(theme: string): EditorOverlayState {
  const typography = typographyTheme(theme);
  const standard = ON_SCREEN_TEXT_THEMES.find(item => item.id === theme);
  const sizes: Record<string, number> = { pop:64, 'bold-center':76, bounce:68, 'highlight-box':60, karaoke:62, minimal:48, podcast:52, typewriter:58, kinetic:64, punch:66, 'yellow-stack':72, 'violet-pill':64, 'dual-line':64, 'bold-karaoke':64, 'soft-lyric':48 };
  const position = { x: 50, y: typography ? 72 : ['minimal', 'soft-lyric'].includes(theme) ? 60 : 62 };
  return { ...structuredClone(DEFAULT_EDITOR_OVERLAYS), globalCaptionPosition: position, caption: { ...DEFAULT_EDITOR_OVERLAYS.caption, theme, position, color: typography?.baseColor ?? standard?.color ?? "#FFFFFF", accentColor: typography?.accent ?? standard?.accent ?? "#FFE500", fontSize: typography?.size ?? sizes[theme] ?? 72 } };
}

function groupsFor(words: Word[]): LineGroup[] {
  const groups: LineGroup[] = [];
  for (let i = 0; i < words.length; i += 5) {
    const group = words.slice(i, i + 5);
    groups.push({ id: String(i / 5), words: group, start: group[0].start, end: group[group.length - 1].end });
  }
  return groups;
}

export default function ClipEditor({ path, theme, onClose, onSaved, embedded = false, onDirtyChange, onBusyChange }: { path: string; theme: string; onClose: () => void; onSaved: (path: string) => void; embedded?: boolean; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void }) {
  const [data, setData] = useState<ClipData | null>(null);
  const [mediaInfo, setMediaInfo] = useState({ width: 1, height: 1, duration: 0 });
  const [frameWidth, setFrameWidth] = useState(0);
  const [settings, setSettings] = useState<EditorOverlayState>(() => initialSettings(theme));
  const [tab, setTab] = useState<"captions" | "text" | "logo" | "transcript">("captions");
  const [transcriptDrafts, setTranscriptDrafts] = useState<Record<string,string>>({});
  const baseline = useRef("");
  const [saved, setSaved] = useState(false);
  const [selection, setSelection] = useState<Selection>("captions");
  const [scope, setScope] = useState<"all" | "line">("all");
  const [selectedLine, setSelectedLine] = useState("");
  const [time, setTime] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const captionCanvasRef = useRef<HTMLCanvasElement>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const dragRef = useRef<{ selection: Selection; x: number; y: number; pos: Position } | null>(null);
  const restoringAppearance = useRef(false);
  useEffect(() => { onBusyChange?.(saving); }, [saving]);
  useEffect(() => { if(data && baseline.current) { const dirty = baseline.current !== JSON.stringify({settings,words:data.words}); onDirtyChange?.(dirty); if(dirty)setSaved(false); } }, [settings,data]);

  useEffect(() => {
    if (restoringAppearance.current) { restoringAppearance.current = false; return; }
    const appearance = initialSettings(settings.caption.theme).caption;
    setSettings(current => ({ ...current, caption: { ...current.caption, color: appearance.color, accentColor: appearance.accentColor, fontSize: appearance.fontSize } }));
  }, [settings.caption.theme]);

  useEffect(() => {
    let alive = true;
    setData(null); setMediaInfo({width:1,height:1,duration:0}); setTime(0); setError(""); setTranscriptDrafts({}); baseline.current = "";
    void invoke<ClipData>("read_clip_editor", { path }).then(value => { if (alive) { const nextSettings=value.settings ?? initialSettings(value.theme ?? theme); baseline.current=JSON.stringify({settings:nextSettings,words:value.words}); setData(value); restoringAppearance.current = true; setSettings(nextSettings); onDirtyChange?.(false); } }).catch(reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [path]);
  useEffect(() => {
    const frame = canvasRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(() => setFrameWidth(frame.getBoundingClientRect().width));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  const lines = useMemo(() => data?.lineGroups ?? groupsFor(data?.words ?? []), [data]);
  const currentLine = lines.find(line => time >= line.start && time <= line.end + .08);
  const line = currentLine;
  const captionPosition = line && settings.linePositions[line.id] || settings.globalCaptionPosition;
  const textStyle = ON_SCREEN_TEXT_THEMES.find(item => item.id === settings.caption.theme) ?? ON_SCREEN_TEXT_THEMES[0];
  const isTypography = settings.caption.theme.startsWith("capsnip:");
  useEffect(() => { void loadCapsnipTypographyFonts().then(() => setFontsReady(true)); }, []);
  // Paint typography independently from React's editor controls. Do not recreate
  // a full-resolution canvas or rerender every form field for every video frame.
  const playbackState = useRef({ data, settings, lines, isTypography, fontsReady });
  playbackState.current = { data, settings, lines, isTypography, fontsReady };
  useEffect(() => {
    let frame = 0, lastUi = 0;
    const tick = (now: number) => {
      const video = videoRef.current, canvas = captionCanvasRef.current;
      const state = playbackState.current;
      if (video && canvas) {
        const clock = video.currentTime;
        if (!video.paused && now-lastUi >= 100) { lastUi=now; setTime(clock); }
        const ctx=canvas.getContext("2d");
        if (ctx) {
          const bounds=canvasRef.current?.getBoundingClientRect();
          const pixelRatio=Math.min(window.devicePixelRatio || 1,2);
          const width=Math.max(1,Math.round((bounds?.width || 1)*pixelRatio));
          const height=Math.max(1,Math.round((bounds?.height || 1)*pixelRatio));
          if(canvas.width!==width)canvas.width=width;
          if(canvas.height!==height)canvas.height=height;
          ctx.clearRect(0,0,width,height);
          if(state.data && state.isTypography && state.fontsReady){
            const cueIndex=state.lines.findIndex(cue=>clock>=cue.start && clock<=cue.end+.08);
            const cue=state.lines[cueIndex];
            if(cue){
              const position=state.settings.linePositions[cue.id] || state.settings.globalCaptionPosition;
              drawCapsnipCaption(ctx,{text:cue.words.map(word=>word.text).join(" "),...cue},clock,width,height,state.settings.caption.theme,{x:position.x/100,y:position.y/100},1,cueIndex,{color:state.settings.caption.color,accentColor:state.settings.caption.accentColor,fontSize:state.settings.caption.fontSize});
            }
          }
        }
      }
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(frame);
  }, []);

  function moveSelection(position: Position, target = selection) {
    setSettings(current => {
      if (target === "captions") {
        if (scope === "line" && line) return { ...current, linePositions: { ...current.linePositions, [line.id]: position } };
        return { ...current, globalCaptionPosition: position, caption: { ...current.caption, position } };
      }
      if (target === "logo" && current.logo) return { ...current, logo: { ...current.logo, position } };
      return { ...current, onScreenText: current.onScreenText.map(text => text.id === target ? { ...text, position } : text) };
    });
  }
  function startDrag(event: PointerEvent<HTMLElement>, target: Selection, position: Position) {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    setSelection(target); dragRef.current = { selection: target, x: event.clientX, y: event.clientY, pos: position };
  }
  function drag(event: PointerEvent<HTMLElement>) {
    const dragState = dragRef.current, bounds = canvasRef.current?.getBoundingClientRect();
    if (!dragState || !bounds) return;
    moveSelection({ x: clamp(dragState.pos.x + (event.clientX - dragState.x) / bounds.width * 100), y: clamp(dragState.pos.y + (event.clientY - dragState.y) / bounds.height * 100) }, dragState.selection);
  }
  function stopDrag() { dragRef.current = null; }
  function addText() {
    const id = crypto.randomUUID();
    setSettings(current => ({ ...current, onScreenText: [...current.onScreenText, { id, text: "YOUR TEXT", styleId: "pop", color: "#FFFFFF", position: { x: 50, y: 20 }, scale: 1, opacity: 1 }] }));
    setSelection(id); setTab("text");
  }
  async function addLogo() {
    try {
      const result = await open({ multiple: false, filters: [{ name: "Logo image", extensions: ["png", "jpg", "jpeg", "webp"] }] });
      if (typeof result === "string") {
        setSettings(current => ({ ...current, logo: { src: result, position: { x: 85, y: 12 }, scale: 15, opacity: 1 } }));
        setSelection("logo"); setTab("logo");
      }
    } catch (reason) { setError(String(reason)); }
  }
  async function save() {
    setSaving(true); setError(""); videoRef.current?.pause();
    try { const output = await invoke<string>("render_clip_edit", { path, settings, words:data?.words, lineGroups:data?.lineGroups }); baseline.current=JSON.stringify({settings,words:data?.words}); onDirtyChange?.(false); setSaved(true); onSaved(output); }
    catch (reason) { setError(String(reason)); }
    finally { setSaving(false); }
  }
  const selectedText = settings.onScreenText.find(item => item.id === selection) ?? settings.onScreenText[0];
  const selectedPosition = selection === "captions" ? captionPosition : selection === "logo" ? settings.logo?.position : selectedText?.position;
  const updateText = (changes: Partial<EditorOverlayState["onScreenText"][number]>) => selectedText && setSettings(current => ({ ...current, onScreenText: current.onScreenText.map(text => text.id === selectedText.id ? { ...text, ...changes } : text) }));
  function editLine(item: LineGroup, text: string) {
    setTranscriptDrafts(current=>({...current,[item.id]:text}));
    const tokens=text.trim().split(/\s+/).filter(Boolean);
    if(!tokens.length)return;
    const words=tokens.map((text,index)=>({text,start:tokens.length===item.words.length?item.words[index].start:item.start+(item.end-item.start)*index/tokens.length,end:tokens.length===item.words.length?item.words[index].end:item.start+(item.end-item.start)*(index+1)/tokens.length}));
    setData(current=>{if(!current)return current;const nextLines=(current.lineGroups??groupsFor(current.words)).map(group=>group.id===item.id?{...group,words}:group);return {...current,lineGroups:nextLines,words:nextLines.flatMap(group=>group.words)};});
  }

  return <div className={embedded ? "snip-editor-overlay snip-editor-embedded" : "snip-editor-overlay"} role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-label="Selected clip editor">
    <div className="snip-editor-shell">
      <header className="snip-editor-header"><div><span>SNIP AI · SELECTED CLIP</span><h2>Preview & edit</h2></div><div><button onClick={onClose} disabled={saving}>Show all clips</button></div></header>
      <div className="snip-editor-content">
        <aside className="snip-editor-lines"><h3>Transcript</h3><p>Select a line to place it separately.</p>{lines.map(item => <button className={selectedLine === item.id ? "selected" : ""} key={item.id} onClick={() => { setSelectedLine(item.id); setScope("line"); setSelection("captions"); if (videoRef.current) videoRef.current.currentTime = item.start; setTime(item.start); }}><small>{item.start.toFixed(1)}s</small>{item.words.map(word => word.text).join(" ")}{settings.linePositions[item.id] && <small>Custom position</small>}</button>)}</aside>
        <section className="snip-editor-preview-column">
          <div className="snip-editor-stage"><div ref={canvasRef} className="snip-editor-canvas" style={{ aspectRatio: `${data?.width ?? mediaInfo.width}/${data?.height ?? mediaInfo.height}`, '--clip-aspect': (data?.width ?? mediaInfo.width)/(data?.height ?? mediaInfo.height) } as CSSProperties}>
            <video ref={videoRef} src={convertFileSrc(data?.sourcePath ?? path)} playsInline preload="auto" onLoadedMetadata={event => { const video=event.currentTarget; setMediaInfo({width:video.videoWidth || 1,height:video.videoHeight || 1,duration:Number.isFinite(video.duration)?video.duration:0}); video.currentTime=Math.min(time,Math.max(0,video.duration-.01)); }} onTimeUpdate={event => setTime(event.currentTarget.currentTime)} />
            <canvas className="snip-editor-caption-canvas" ref={captionCanvasRef} />
            {line && <div className={`snip-editor-object snip-editor-captions ${selection === "captions" ? "selected" : ""}`} style={{ left: `${captionPosition.x}%`, top: `${captionPosition.y}%`, fontFamily: textStyle.font, fontSize: `${settings.caption.fontSize / 1080 * 100}cqh`, color: settings.caption.color }} onPointerDown={event => startDrag(event, "captions", captionPosition)} onPointerMove={drag} onPointerUp={stopDrag}>
              {isTypography ? <span style={{ opacity: 0 }}>Move caption</span> : <>
              {line.words.filter(word => word.start <= time + .06).map((word, index) => <span key={index} style={{ color: time >= word.start && time <= word.end ? settings.caption.accentColor : settings.caption.color }}>{word.text}{" "}</span>)}
              </>}
            </div>}
            {data && settings.onScreenText.map(text => { const style = ON_SCREEN_TEXT_THEMES.find(item => item.id === text.styleId) ?? ON_SCREEN_TEXT_THEMES[0]; return <div key={text.id} className={`snip-editor-object snip-editor-text text-style-${text.styleId} ${selection === text.id ? "selected" : ""}`} style={{ left: `${text.position.x}%`, top: `${text.position.y}%`, fontSize: `${5.5 * text.scale}cqw`, opacity: text.opacity, fontFamily: style.font, color: text.color }} onPointerDown={event => startDrag(event, text.id, text.position)} onPointerMove={drag} onPointerUp={stopDrag}>{text.text}</div>; })}
            {data && settings.logo && <img className={`snip-editor-object snip-editor-logo ${selection === "logo" ? "selected" : ""}`} src={convertFileSrc(settings.logo.src)} alt="Logo overlay" draggable={false} style={{ left: `${settings.logo.position.x}%`, top: `${settings.logo.position.y}%`, width: `${settings.logo.scale}%`, opacity: settings.logo.opacity }} onPointerDown={event => startDrag(event, "logo", settings.logo!.position)} onPointerMove={drag} onPointerUp={stopDrag} />}
          </div></div>
          <div className="snip-editor-transport" style={frameWidth ? {width:frameWidth} : undefined}><button aria-label="Play or pause clip" onClick={() => { const video = videoRef.current; if (!video) return; if (video.paused) void video.play(); else video.pause(); }}>▶ / Ⅱ</button><input aria-label="Seek clip" type="range" min="0" max={data?.duration || mediaInfo.duration || 1} step=".02" value={time} onChange={event => { const next = Number(event.target.value); setTime(next); if (videoRef.current) videoRef.current.currentTime = next; }} /><span>{time.toFixed(1)} / {(data?.duration ?? mediaInfo.duration).toFixed(1)}s</span></div>
          <div className="snip-editor-help">{!data && !error ? "Video ready · loading editing controls…" : "Drag the outlined caption, text or logo to position it. Changes are saved to a new MP4."}</div>
          {error && <div className="snip-editor-error" role="alert">{error}</div>}
        </section>
        <aside className="snip-editor-controls">
          <div className="snip-editor-tabs">{(["captions", "transcript", "text", "logo"] as const).map(value => <button key={value} disabled={saving} className={tab === value ? "selected" : ""} onClick={() => { setTab(value); setSelection(value === "text" ? selectedText?.id ?? "text" : value); }}>{value === "text" ? "Text" : value === "logo" ? "Logo" : value === "transcript" ? "Transcript" : "Captions"}</button>)}</div>
          <div className={`editor-tab-content tab-${tab}`}>
          {tab === "captions" && <>
            <label className="editor-style-field"><span>Caption style</span><select value={settings.caption.theme} onChange={event => { const nextTheme = event.target.value; const catalog = typographyTheme(nextTheme); setSettings(current => ({ ...current, caption: { ...current.caption, theme: nextTheme, ...(catalog ? { color: catalog.baseColor ?? "#FFFFFF", accentColor: catalog.accent ?? "#FFE500" } : {}) } })); }}><optgroup label="Snip AI">{ON_SCREEN_TEXT_THEMES.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</optgroup><optgroup label="Capsnip Typography">{CAPSNIP_TYPOGRAPHY_THEMES.map(item => <option value={item.name} key={item.name}>{item.label}</option>)}</optgroup></select></label>
            <div className="editor-color-row"><ColorPill label="Normal" value={settings.caption.color} onChange={value => setSettings(current => ({ ...current, caption: { ...current.caption, color:value } }))}/><ColorPill label="Emphasis" value={settings.caption.accentColor} onChange={value => setSettings(current => ({ ...current, caption: { ...current.caption, accentColor:value } }))}/></div>
            <RulerSlider label="Caption size" min={12} max={180} value={settings.caption.fontSize} onChange={value=>setSettings(current=>({...current,caption:{...current.caption,fontSize:value}}))}/>
            <div className="editor-scope"><span>Move captions</span><div className="snip-editor-two"><button className={scope === "all" ? "selected" : ""} onClick={() => { setScope("all"); setSelection("captions"); }}>All captions</button><button className={scope === "line" ? "selected" : ""} disabled={!line} onClick={() => { setSelectedLine(line?.id ?? ""); setScope("line"); setSelection("captions"); }}>One line</button></div></div>
            <p className="editor-field-hint">{scope === "all" ? "Drag to move all captions together." : "Only this line moves."}</p>
            {scope === "line" && line && <button className="editor-reset-line" onClick={() => setSettings(current => { const positions = { ...current.linePositions }; delete positions[line.id]; return { ...current, linePositions: positions }; })}>Reset this line</button>}
          </>}
          {tab === "text" && <>
            <div className="editor-section-heading"><h3>On-screen text</h3><button className="editor-add-text" onClick={addText}><Plus size={13}/>Add text</button></div>
            {settings.onScreenText.length > 1 && <select className="editor-text-selector" aria-label="Select text overlay" value={selectedText?.id} onChange={event => setSelection(event.target.value)}>{settings.onScreenText.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.text}</option>)}</select>}
            {selectedText ? <>
              <label className="editor-text-input"><span>Text</span><textarea rows={2} value={selectedText.text} maxLength={140} onChange={event => updateText({ text: event.target.value })}/></label>
              <ColorPill label="Text colour" value={selectedText.color} onChange={value=>updateText({color:value})}/>
              <RulerSlider label="Text size" min={.2} max={3} step={.05} value={selectedText.scale} unit="×" onChange={value=>updateText({scale:value})}/>
            </> : <p className="editor-text-empty">Add text or choose a style to start.</p>}
            <details className="editor-style-picker"><summary><span>Text style</span><b>{ON_SCREEN_TEXT_THEMES.find(item=>item.id===selectedText?.styleId)?.label || '15 styles'}</b><ChevronDown size={13}/></summary><div className="snip-editor-text-grid">{ON_SCREEN_TEXT_THEMES.map(item => <button key={item.id} className={selectedText?.styleId === item.id ? "selected" : ""} onClick={event => { if (selectedText) updateText({ styleId: item.id, color: item.color }); else { const id = crypto.randomUUID(); setSettings(current => ({ ...current, onScreenText: [...current.onScreenText, { id, text: "YOUR TEXT", styleId: item.id, color: item.color, position: { x: 50, y: 20 }, scale: 1, opacity: 1 }] })); setSelection(id); } event.currentTarget.closest('details')?.removeAttribute('open'); }}><OnScreenTextPreview theme={item}/><small>{item.label}</small></button>)}</div></details>
            {selectedText && <button className="editor-remove-text" onClick={() => { setSettings(current => ({ ...current, onScreenText: current.onScreenText.filter(item => item.id !== selectedText.id) })); setSelection("text"); }}><Trash2 size={12}/>Remove text</button>}
          </>}
          {tab === "logo" && <><h3>Logo overlay</h3><button className="snip-editor-primary" onClick={() => void addLogo()}>{settings.logo ? "Replace logo" : "+ Upload logo"}</button><p className="editor-field-hint">PNG, JPEG or WebP.</p>{settings.logo && <><img className="snip-editor-logo-thumbnail" alt="Selected logo" src={convertFileSrc(settings.logo.src)}/><RulerSlider label="Logo size" min={2} max={60} value={settings.logo.scale} unit="%" onChange={value=>setSettings(current=>({...current,logo:current.logo&&{...current.logo,scale:value}}))}/><RulerSlider label="Opacity" min={.1} max={1} step={.05} value={settings.logo.opacity} onChange={value=>setSettings(current=>({...current,logo:current.logo&&{...current.logo,opacity:value}}))}/><button onClick={() => setSettings(current => ({ ...current, logo: null }))}>Remove logo</button></>}</>}
          {tab !== 'transcript' && selectedPosition && <fieldset className="editor-position-fields"><legend>Position</legend><div className="snip-editor-two"><label><span>X</span><input aria-label="Horizontal position" type="number" min="0" max="100" value={Math.round(selectedPosition.x)} onChange={event => moveSelection({ ...selectedPosition, x: clamp(Number(event.target.value)) })}/><small>%</small></label><label><span>Y</span><input aria-label="Vertical position" type="number" min="0" max="100" value={Math.round(selectedPosition.y)} onChange={event => moveSelection({ ...selectedPosition, y: clamp(Number(event.target.value)) })}/><small>%</small></label></div></fieldset>}
          {tab === "transcript" && <div className="editor-transcript-list"><h3>Transcript</h3><p>Change words. Original timing stays.</p>{lines.map(item=><div className="editor-transcript-row" key={item.id}><button onClick={()=>{setSelectedLine(item.id);setTime(item.start);if(videoRef.current)videoRef.current.currentTime=item.start;}}>{item.start.toFixed(1)}s <span>— {item.end.toFixed(1)}s</span></button><textarea rows={2} disabled={saving} aria-label={`Transcript at ${item.start.toFixed(1)} seconds`} value={transcriptDrafts[item.id] ?? item.words.map(word=>word.text).join(" ")} onChange={event=>editLine(item,event.target.value)}/></div>)}</div>}
          </div>
          <footer className="snip-editor-save"><button className="snip-editor-primary" onClick={()=>void save()} disabled={!data || saving}>{saving ? "Saving changes…" : saved ? "Saved ✓" : "Save Changes"}</button><p>{saved ? "Saved clip is ready to export." : "Save before exporting this clip."}</p></footer>
        </aside>
      </div>
    </div>
  </div>;
}
