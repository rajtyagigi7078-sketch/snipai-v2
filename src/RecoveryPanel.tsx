import {Component, useEffect, useState, type ReactNode} from 'react';
import {invoke} from './lib/desktop';

export function errorCause(message:string){
 if(/dynamically imported module|module script|Loading chunk|Failed to fetch.*module/i.test(message))return 'A screen module could not load. The app may have updated while open. Restart Snip AI to load the current build.';
 if(/This video is unavailable|Video unavailable|Private video/i.test(message))return 'YouTube could not provide this video. Check that the link opens for you, or import a local video file.';
 if(/network|fetch|offline|timeout|429/i.test(message))return 'The service could not respond. Check your connection; rate limits may need time before retrying.';
 if(/permission|access.*denied|EPERM|EACCES/i.test(message))return 'Windows blocked access. Choose a file and output folder you can access.';
 if(/no speech|no audio|no playable|unsupported|invalid.*video/i.test(message))return 'The selected media cannot be processed with these settings. Choose a supported video with clear speech.';
 if(/(?:No usable spoken moments|No clear spoken voice|Voice was detected|No unused clips met the quality threshold|Word timestamps are missing|The selected video is shorter)/i.test(message))return message;
 if(/disk full|ENOSPC|no space left|not enough.*space/i.test(message))return 'There may not be enough free storage. Free space on the output drive before retrying.';
 if(/license|activation|\b(?:invalid|expired|revoked) key\b|\blicen[cs]e key\b/i.test(message))return 'Check your activation key and connection. Resetting the workspace does not change license eligibility.';
 if(/RUNTIME_DEPENDENCY:|missing DLL|3221225477/i.test(message))return 'The local processing engine could not start or stopped unexpectedly. See the technical details for the engine that failed.';
 if(/already running|still stopping/i.test(message))return 'Another media task is still active. Wait for that task to finish stopping, then retry.';
 return 'This action could not finish. Use the technical details below to check what went wrong.';
}

export function RecoveryActions(){
 const [busy,setBusy]=useState(''),[note,setNote]=useState('');
 async function run(kind:'restart'|'runtime'){
  setBusy(kind);setNote('');
  try{await invoke(kind==='restart'?'reset_workspace':'repair_runtime');if(kind==='runtime')setNote('Runtime repair completed. Retry your action.');}
  catch(reason){setNote(`Recovery could not finish: ${String(reason)}. Close and reopen Snip AI; reinstall if bundled files are missing.`);}
  finally{setBusy('');}
 }
 return <div className="recovery-actions"><div><button type="button" disabled={!!busy} onClick={()=>void run('restart')}>{busy==='restart'?'Restarting…':'Fix & restart'}</button><button type="button" disabled={!!busy} onClick={()=>void run('runtime')}>{busy==='runtime'?'Repairing…':'Repair runtime'}</button></div><small>Stops active tasks and clears the current unsaved workspace. Saved videos, history and activation stay safe.</small>{note&&<p role="status">{note}</p>}</div>;
}

export default function RecoveryPanel({message,title='This action needs attention',unexpected=false}:{message:string;title?:string;unexpected?:boolean}){
 return <section className="recovery-panel" role="alert"><strong>{title}</strong><p>{errorCause(message)}</p>{unexpected&&<RecoveryActions/>}<details><summary>Technical details</summary><pre>{message}</pre></details></section>;
}

export class AppErrorBoundary extends Component<{children:ReactNode},{error:string}>{
 state={error:''};
 static getDerivedStateFromError(error:Error){return {error:error.message||'The screen could not load.'};}
 render(){return this.state.error?<main className="recovery-fallback"><RecoveryPanel unexpected title="The screen could not load" message={this.state.error}/></main>:this.props.children;}
}

export function UnexpectedErrorNotice(){
 const [error,setError]=useState('');
 useEffect(()=>{const rejection=(event:PromiseRejectionEvent)=>setError(String(event.reason?.message||event.reason||'Unexpected background error'));window.addEventListener('unhandledrejection',rejection);return()=>window.removeEventListener('unhandledrejection',rejection);},[]);
 return error?<aside className="recovery-notice"><button type="button" aria-label="Dismiss error" onClick={()=>setError('')}>×</button><RecoveryPanel unexpected message={error}/></aside>:null;
}
