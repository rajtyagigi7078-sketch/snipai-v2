import RecoveryPanel from './RecoveryPanel';
export default function GenerationError({message,onPickVideo}:{message:string;onPickVideo:()=>void}){
 return <div className="generation-recovery"><RecoveryPanel title="Couldn’t finish this generation" message={message}/><button type="button" onClick={onPickVideo}>Choose another video</button></div>;
}
