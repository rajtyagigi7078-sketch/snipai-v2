import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync,createPortal} from 'react-dom';
import {FileVideo,AudioLines,Sparkles,Scissors,Captions,Check} from 'lucide-react';
import RenderProgress from '../src/RenderProgress';
import GenerationError from '../src/GenerationError';
function Fixture(){
  const [open,setOpen]=useState(false);
  useEffect(()=>{(window as any).qaShowError=()=>{const workspace=document.querySelector('.video-loaded')!;const host=document.createElement('div');document.body.append(host);flushSync(()=>createRoot(host).render(createPortal(<GenerationError message={'RUNTIME_DEPENDENCY: Snip AI could not start its bundled engines.\nCould not find module msvcp140.dll'} onPickVideo={()=>{}}/>,workspace)));workspace.insertBefore(workspace.querySelector('.processing-error')!,workspace.querySelector('.generation-controls-footer'));};(window as any).snipaiDesktop={invoke:async()=>({ok:true})};},[]);
  useEffect(()=>{const button=document.querySelector('.generate-button');const start=()=>setOpen(true);button?.addEventListener('click',start);(window as unknown as {qaReady:boolean}).qaReady=true;return()=>button?.removeEventListener('click',start);},[]);
  const stages=[['Preparing video',FileVideo],['Transcribing audio',AudioLines],['Finding best moments',Sparkles],['Creating clips',Scissors],['Applying captions',Captions],['Finalizing',Check]].map(([title,icon])=>({title:String(title),description:'Processing locally on your computer.',icon:icon as typeof Sparkles}));
  return open?<RenderProgress stages={stages} stage={4} percent={87} elapsed="4 min 12 sec" remaining="About 1 min 35 sec" detail="Applying captions · Clip 6 of 10" videoName="The One Habit That Changes Everything.mp4" count={10} format="9:16" batch={{completed:5,total:10,current:6,fraction:.43}} stopping={false} onStop={()=>setOpen(false)}/>:null;
}
flushSync(()=>createRoot(document.getElementById('qa-react')!).render(<Fixture/>));
