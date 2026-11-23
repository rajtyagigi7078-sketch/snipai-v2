import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {AlertTriangle,X,Upload} from 'lucide-react';
import {errorCause} from './RecoveryPanel';

export default function ErrorModal({message,onDismiss,onPickVideo}:{message:string;onDismiss:()=>void;onPickVideo:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const node=dialog.current;
  if(message&&!node?.open)node?.showModal();
  else if(!message&&node?.open)node.close();
 },[message]);
 return createPortal(<dialog ref={dialog} className="studio-error-modal" aria-labelledby="studio-error-title" onClose={onDismiss}>
  <button type="button" className="studio-error-close" aria-label="Close error" onClick={()=>dialog.current?.close()}><X size={18}/></button>
  <div className="studio-error-symbol"><AlertTriangle size={25}/></div>
  <h2 id="studio-error-title">Couldn’t finish this action</h2>
  <p>{errorCause(message)}</p>
  <button type="button" className="studio-error-pick" onClick={()=>{dialog.current?.close();onPickVideo();}}><Upload size={15}/>Choose another video</button>
  <details><summary>Technical details</summary><pre>{message}</pre></details>
 </dialog>,document.body);
}
