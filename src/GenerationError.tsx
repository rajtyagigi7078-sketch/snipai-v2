import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import RecoveryPanel from './RecoveryPanel';

export default function GenerationError({message,onDismiss,onPickVideo}:{message:string;onDismiss:()=>void;onPickVideo:()=>void}){
 return createPortal(
  <aside className="generation-recovery" aria-label="Generation error">
   <button type="button" className="generation-recovery-dismiss" aria-label="Dismiss generation error" onClick={onDismiss}><X size={16}/></button>
   <RecoveryPanel title="Couldn’t finish this generation" message={message}/>
   <button type="button" onClick={onPickVideo}>Choose another video</button>
  </aside>,
  document.body
 );
}
