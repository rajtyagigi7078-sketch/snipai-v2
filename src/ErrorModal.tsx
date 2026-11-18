import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {AlertTriangle,X,RotateCcw,Wrench,Upload} from 'lucide-react';
import {errorCause} from './RecoveryPanel';
import {invoke} from './lib/desktop';

export default function ErrorModal({message,onDismiss,onPickVideo}:{message:string;onDismiss:()=>void;onPickVideo:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [busy,setBusy]=useState(''),[result,setResult]=useState('');
 const visible=message||result;
 useEffect(()=>{const node=dialog.current;if(visible&&!node?.open)node?.showModal();else if(!visible&&node?.open)node.close();},[visible]);
 function close(){dialog.current?.close();setResult('');onDismiss();}
 async function recover(kind:'runtime'|'restart'){
  if(busy)return;
  close();setBusy(kind);
  try{await invoke(kind==='runtime'?'repair_runtime':'reset_workspace');if(kind==='runtime')setResult('Runtime repair completed. You can retry generation.');}
  catch(reason){setResult(`Recovery could not finish: ${String(reason)}`);}
  finally{setBusy('');}
 }
 return createPortal(<>{busy&&<div className="error-recovery-status" role="status">{busy==='runtime'?'Repairing runtime…':'Restarting workspace…'}</div>}<dialog ref={dialog} className="studio-error-modal" aria-labelledby="studio-error-title" onCancel={event=>{event.preventDefault();close();}} onClose={()=>{onDismiss();setResult('');}}><button type="button" className="studio-error-close" aria-label="Close error" onClick={close}><X size={18}/></button><div className="studio-error-symbol"><AlertTriangle size={25}/></div><span className="studio-error-eyebrow">SNIP AI · RECOVERY</span><h2 id="studio-error-title">{message?'Couldn’t finish this action':'Recovery update'}</h2><p>{message?errorCause(message):result}</p>{message&&<><div className="studio-error-actions"><button type="button" disabled={!!busy} onClick={()=>void recover('runtime')}><Wrench size={15}/>Repair runtime</button><button type="button" disabled={!!busy} onClick={()=>void recover('restart')}><RotateCcw size={15}/>Fix & restart</button></div><small>Restart stops active tasks and clears unsaved edits. Saved videos and activation are preserved.</small><button type="button" className="studio-error-pick" onClick={()=>{close();onPickVideo();}}><Upload size={15}/>Choose another video</button><details><summary>Technical details</summary><pre>{message}</pre></details></>}{!message&&<button type="button" className="studio-error-pick" onClick={close}>Back to workspace</button>}</dialog></>,document.body);
}
