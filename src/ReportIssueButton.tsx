import {Mail} from 'lucide-react';
import {openUrl} from './lib/desktop';
export const SUPPORT_COMPOSE_URL='https://mail.google.com/mail/?view=cm&fs=1&to=snipaisupport%40gmail.com&su=Snip%20AI%20issue%20report';
export default function ReportIssueButton({onError}:{onError?:(message:string)=>void}){
  return <button type="button" className="nav-item report-issue" onClick={()=>void openUrl(SUPPORT_COMPOSE_URL).catch(error=>onError?.(String(error)))}><Mail size={18}/><span>Report an issue</span></button>;
}
