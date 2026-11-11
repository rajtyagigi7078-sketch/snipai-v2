import {useLayoutEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {ArrowRight,Check,Clapperboard,HardDrive,RotateCcw,Sparkles} from 'lucide-react';

export default function GenerationComplete({count,format,style,onPreview,onCreate}:{count:number;format:string;style:string;onPreview:()=>void;onCreate:()=>void}){
  const panel=useRef<HTMLElement>(null);
  useLayoutEffect(()=>{const root=document.getElementById('root'),oldInert=root?.inert ?? false,oldOverflow=document.body.style.overflow;const oldFocus=document.activeElement as HTMLElement|null;document.body.style.overflow='hidden';if(root)root.inert=true;panel.current?.focus({preventScroll:true});return()=>{document.body.style.overflow=oldOverflow;if(root)root.inert=oldInert;oldFocus?.focus({preventScroll:true});};},[]);
  const content=<div className="finish-overlay"><section ref={panel} className="finish-card" role="dialog" aria-modal="true" aria-labelledby="finish-title" tabIndex={-1} onKeyDown={event=>{if(event.key!=='Tab')return;const buttons=panel.current?.querySelectorAll('button');if(!buttons?.length)return;const first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===panel.current)){event.preventDefault();first.focus();}}}>
    <header className="finish-top"><span><Sparkles size={15}/> SNIP AI · CREATION COMPLETE</span><span className="finish-local"><HardDrive size={13}/> Saved on your device</span></header>
    <div className="finish-hero"><div className="finish-art" aria-hidden="true"><i/><i/><i/><span className="finish-art-check"><Check size={30}/></span><Sparkles className="finish-spark" size={18}/></div><div><span className="finish-eyebrow">READY FOR YOUR NEXT POST</span><h2 id="finish-title">Your clips.<br/><em>Ready to shine.</em></h2><p>The edit is done. Your next great post starts with a preview.</p></div></div>
    <div className="finish-summary"><div><Clapperboard size={17}/><strong>{count}</strong><span>clips created</span></div><div><strong>{format}</strong><span>video format</span></div><div><strong title={style}>{style}</strong><span>caption style</span></div></div>
    <div className="finish-actions"><button onClick={onCreate}><RotateCcw size={15}/>Create another</button><button className="finish-preview" onClick={onPreview} disabled={!count}>Preview your clips<ArrowRight size={17}/></button></div>
  </section></div>;
  return typeof document==='undefined'?content:createPortal(content,document.body);
}
