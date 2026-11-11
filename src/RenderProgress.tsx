import { Check, ChevronRight, CircleStop, Cpu, FileVideo2, Sparkles, Timer, Zap, type LucideIcon } from 'lucide-react';
import './render-progress.css';
import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  stages: { title: string; description: string; icon: LucideIcon }[];
  stage: number; percent: number; elapsed: string; remaining: string;
  detail: string; videoName: string; count: number; format: string;
  batch: { completed: number; total: number; current: number; fraction: number } | null;
  stopping: boolean; onStop: () => void;
};

export default function RenderProgress(p: Props) {
  const overlay = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = document.getElementById('root');
    const previousInert = root?.inert ?? false, previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    if (root) root.inert = true;
    overlay.current?.focus({ preventScroll: true });
    return () => { document.body.style.overflow = previousOverflow; if(root)root.inert=previousInert; previousFocus?.focus({preventScroll:true}); };
  }, []);
  const active = p.stages[Math.min(p.stage, p.stages.length - 1)];
  const Icon = active.icon;
  const percent = Math.round(p.percent);
  const content = <div ref={overlay} className="render-overlay" role="dialog" aria-modal="true" aria-labelledby="render-title" tabIndex={-1} onKeyDown={event=>{
    if(event.key !== 'Tab')return;
    const items=overlay.current?.querySelectorAll<HTMLElement>('button:not(:disabled),summary');
    if(!items?.length){event.preventDefault();return;}
    const first=items[0],last=items[items.length-1];
    if(event.shiftKey && (document.activeElement===first || document.activeElement===overlay.current)){event.preventDefault();last.focus();}
    else if(!event.shiftKey && (document.activeElement===last || document.activeElement===overlay.current)){event.preventDefault();first.focus();}
  }}>
    <section className="render-studio">
      <header className="render-topbar"><span className="render-brand"><Sparkles size={18}/> SNIP AI <i/> RENDER STUDIO</span><span className="render-live"><b/> Local engine running</span></header>
      <div className="render-body">
        <aside className="render-journey">
          <span className="render-eyebrow">FROM RECORDING TO READY</span>
          <h2 id="render-title">Good moments.<br/><em>Taking shape.</em></h2>
          <p>Your next clips are coming together.<br/>We’ll take it from here.</p>
          <ol className="render-steps" aria-label="Generation steps">
            {p.stages.map((stage, i) => {
              const done=i<p.stage, current=i===p.stage, StageIcon=stage.icon;
              return <li className={`${done?'is-done':''} ${current?'is-current':''}`} key={stage.title} aria-current={current?'step':undefined}>
                <span className="render-step-symbol" key={`${i}-${done}`}>
                  {done ? <Check size={19} strokeWidth={2.7}/> : <StageIcon size={18}/>}
                  {done && <span className="render-step-burst"/>}
                </span>
                <span className="render-step-copy"><strong>{stage.title}</strong><small>{done?'Complete':current?'In progress':`Step ${String(i+1).padStart(2,'0')}`}</small></span>
                {current && <span className="render-step-pulse"/>}
                {done && <span className="render-done-label">DONE</span>}
              </li>;
            })}
          </ol>
        </aside>
        <main className="render-focus">
          <div className="render-visual" aria-hidden="true">
            <div className="render-shape render-shape-a"/><div className="render-shape render-shape-b"/>
            <span className="render-orbit-spark"><Sparkles size={19}/></span>
            <svg className="render-ring" viewBox="0 0 240 240"><defs><linearGradient id="render-ring-gradient" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#b7a1ff"/><stop offset=".55" stopColor="#76deed"/><stop offset="1" stopColor="#efb4df"/></linearGradient></defs><circle className="render-ring-track" cx="120" cy="120" r="102"/><circle className="render-ring-fill" cx="120" cy="120" r="102" pathLength="100" strokeDasharray="100" strokeDashoffset={100-percent}/></svg>
            <div className="render-ring-center"><span>CREATING</span><strong>{percent}<small>%</small></strong><div className="render-wave">{Array.from({length:9},(_,i)=><i key={i} style={{animationDelay:`${i*90}ms`}}/>)}</div></div>
            <span className="render-floating-tag"><Zap size={13}/> On your device</span>
          </div>
          <div className="render-phase" key={p.stage}><span className="render-phase-icon"><Icon size={22}/></span><div><span className="render-eyebrow">{p.batch?`${p.batch.completed} OF ${p.batch.total} CLIPS READY`:`STEP ${String(p.stage+1).padStart(2,'0')} / ${String(p.stages.length).padStart(2,'0')}`}</span><h3>{active.title}</h3><p>{p.batch?`Clip ${p.batch.current} of ${p.batch.total} · ${Math.round(p.batch.fraction*100)}% of this caption render`:active.description}</p></div></div>
          <div className="render-metrics"><div><span><Timer size={14}/> Estimated remaining</span><strong>{p.remaining}</strong></div><div><span><Cpu size={14}/> Time elapsed</span><strong>{p.elapsed}</strong></div></div>
          <div className="render-output"><span><FileVideo2 size={17}/> {p.count} clips</span><ChevronRight size={13}/><span>{p.format} frame</span><ChevronRight size={13}/><span>MP4 output</span></div>
        </main>
      </div>
      <footer className="render-bottom"><div className="render-source"><FileVideo2 size={17}/><span title={p.videoName}>{p.videoName}</span></div><button type="button" onClick={p.onStop} disabled={p.stopping}><CircleStop size={16}/>{p.stopping?'Stopping…':'Stop generation'}</button></footer>
      <details className="render-diagnostics"><summary>Technical details</summary><pre>{p.detail || 'Preparing local engine…'}</pre></details>
    </section>
  </div>;
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}
