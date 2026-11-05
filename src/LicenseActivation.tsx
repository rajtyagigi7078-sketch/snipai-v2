import { Check, KeyRound, ShieldCheck } from "lucide-react";
import { getStoredLicenseState } from "./lib/license";

export default function LicenseActivation() {
  const license = getStoredLicenseState();

  return (
    <div className="settings-card license-settings-card">
      <div className="settings-card-title">
        <div className="settings-card-icon"><KeyRound size={17} /></div>
        <div>
          <strong>Snip Store license</strong>
          <span>One-time activation for this computer.</span>
        </div>
      </div>
      <div className="license-active-box" role="status">
        <div className="license-active-icon"><Check size={17} /></div>
        <div>
          <strong>{license.active ? "Lifetime access active" : "Activation required"}</strong>
          <span>{license.active
            ? `Snip AI is activated on this computer${license.keyLast4 ? ` · key ending ${license.keyLast4}` : ""}.`
            : "Restart Snip AI and enter the Snip Store key to activate."}</span>
        </div>
        <ShieldCheck size={17} />
      </div>
    </div>
  );
}
