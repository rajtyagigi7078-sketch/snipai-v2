import {useRef,useState} from 'react';
import {invoke} from './lib/desktop';

export default function GenerationError({message,onPickVideo}:{message:string;onPickVideo:()=>void}){
 const [busy,setBusy]=useState(false),[note,setNote]=useState(''),[fixed,setFixed]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null);
 const runtime=/RUNTIME_DEPENDENCY:|Could not find module|DLL load failed|WinError 126|bundled.+missing/i.test(message);
 async function repair(){setBusy(true);setNote('Windows may ask permission to repair its runtime.');try{await invoke('repair_runtime');setFixed(true);setNote('Runtime checks passed. Click Generate clips to try again.');}catch(e){setNote(String(e));}finally{setBusy(false);}}
 async function copy(){try{await navigator.clipboard.writeText(message);setNote('Error report copied. Send it to snipaisupport@gmail.com.');}catch{setNote('Copy failed. Open Error details and select the report text.');}}
 const summary=runtime?'A bundled Windows dependency could not load. Repair it here; no separate download is needed.':message.length<420?message:'Open Error details or copy the report so we can identify the exact failure.';
 return <div className={`processing-error ${fixed?'runtime-fixed':''}`} role="alert"><div className="generation-error-summary"><strong>{fixed?'Runtime ready':runtime?'Runtime needs repair':"Couldn’t finish this generation"}</strong><p>{fixed?'The speech and video engines are ready.':summary}</p></div><div className="generation-error-actions">{runtime&&<button disabled={busy} onClick={()=>void repair()}>{busy?'Repairing…':'Repair runtime'}</button>}<button disabled={busy} onClick={()=>dialog.current?.showModal()}>Error details</button><button disabled={busy} onClick={()=>void copy()}>Copy error</button><button disabled={busy} onClick={onPickVideo}>Choose another video</button></div>{note&&<p className="generation-error-note">{note}</p>}<dialog className="generation-error-dialog" ref={dialog}><header><h2>Error details</h2><button onClick={()=>dialog.current?.close()} aria-label="Close error details">Close</button></header><p>Send this report to snipaisupport@gmail.com.</p><pre>{message}</pre><button onClick={()=>void copy()}>Copy error report</button></dialog></div>;
}
