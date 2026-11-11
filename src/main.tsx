import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import LicenseActivationScreen from "./LicenseActivationScreen";
import { getStoredLicenseState, prepareLegacyDevice } from "./lib/license";
import "./refinement.css";
import "./creative.css";
import "./preview-workspace.css";
import "./generation-layout.css";
import "./ui-polish.css";

function LoadingScreen() {
  return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#000", color: "#aaa" }}>Loading Snip AI…</div>;
}

function Root() {
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(false);
  useEffect(()=>{const update=()=>setActive(getStoredLicenseState().active);window.addEventListener('snip-license-changed',update);return()=>window.removeEventListener('snip-license-changed',update);},[]);
  useEffect(() => {
    // This app now activates directly with a Snip Store key. Remove any
    // Supabase Auth session left by older email/password/OTP builds.
    try {
      const projectRef = new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split(".")[0];
      localStorage.removeItem(`sb-${projectRef}-auth-token`);
      localStorage.removeItem(`sb-${projectRef}-auth-token-code-verifier`);
    } catch { /* keep app startup available if local storage is unavailable */ }
    void prepareLegacyDevice().finally(()=>{
      setActive(getStoredLicenseState().active);
      setLoading(false);
    });
  }, []);
  useEffect(()=>{if(!loading)window.snipaiDesktop?.reportUiReady?.(active?'workspace':'activation');},[loading,active]);
  if (loading) return <LoadingScreen />;
  return active ? <App /> : <LicenseActivationScreen onLicenseActivated={() => setActive(true)} />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode><Root /></React.StrictMode>,
);
