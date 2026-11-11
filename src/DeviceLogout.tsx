import { useState } from 'react';
import { LogOut, KeyRound, X, LoaderCircle } from 'lucide-react';
import { getStoredLicenseState, releaseThisDevice } from './lib/license';

export default function DeviceLogout({disabled=false}:{disabled?:boolean}) {
  const [visible,setVisible]=useState(false),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const license=getStoredLicenseState();
  return <><button className="nav-item logout-device" disabled={disabled} title={disabled?'Finish your current work before logging out':'Log out and release this device'} onClick={()=>{setVisible(true);setError('');}}><LogOut size={18}/><span>Log out</span></button>
    {visible && <div className="device-logout-backdrop"><form className="device-logout-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-title" onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{await releaseThisDevice(key);}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}}}>
      <button type="button" className="dialog-close" aria-label="Close logout dialog" disabled={busy} onClick={()=>{setVisible(false);setKey('');}}><X size={18}/></button><div className="dialog-icon"><LogOut size={24}/></div><span className="eyebrow">YOUR LIFETIME LICENSE</span><h2 id="logout-title">Take your key with you.</h2><p>Log out to release this computer. You can then activate the same key on another computer. Your projects stay here.</p><label htmlFor="release-key">Confirm your key{license.keyLast4?` · ending ${license.keyLast4}`:''}</label><div className="release-key-input"><KeyRound size={18}/><input id="release-key" autoFocus autoComplete="off" value={key} disabled={busy} onChange={event=>setKey(event.target.value.toUpperCase())} placeholder="SNIP-AI-XXXXX-XXXXX-XXXXX" required /></div>{error&&<p role="alert" className="logout-error">{error}</p>}<button type="submit" className="logout-submit" disabled={busy||!key.trim()}>{busy?<><LoaderCircle size={17} className="button-spinner"/>Releasing this device…</>:<>Log out & release device<LogOut size={17}/></>}</button><small>Internet is required to release your activation.</small>
    </form></div>}
  </>;
}
