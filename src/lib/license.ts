import { supabase } from "./supabase";

const STATE_KEY = "snip-ai.store-license.v1";
const DEVICE_KEY = "snip-ai.install-id.v1";

export type LicenseState = { active: boolean; keyLast4?: string | null };

type StoredLicense = { active: true; productSlug: "snip-ai"; keyLast4: string; activatedAt: string };

// Keep the former Tauri installation identity when activating the same key in
// Electron. Existing saved activation and all old profile files remain intact.
export async function prepareLegacyDevice() {
  if(localStorage.getItem(DEVICE_KEY)||!window.snipaiDesktop?.invoke)return;
  try{
    const candidate=await window.snipaiDesktop.invoke<{deviceId:string;keyLast4:string}|null>('legacy_license_candidate');
    if(candidate&&/^[a-f0-9-]{32,64}$/i.test(candidate.deviceId))localStorage.setItem(DEVICE_KEY,candidate.deviceId);
  }catch{ /* Activation still works for a fresh installation. */ }
}

function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getStoredLicenseState(): LicenseState {
  try {
    const value = JSON.parse(localStorage.getItem(STATE_KEY) || "null") as StoredLicense | null;
    return { active: value?.active === true && value.productSlug === "snip-ai", keyLast4: value?.keyLast4 || null };
  } catch { return { active: false }; }
}

export async function activateLifetimeLicense(licenseKey: string) {
  const key = licenseKey.trim().toUpperCase();
  if (!key) throw new Error("Enter your Snip Store activation key.");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const { data, error } = await supabase.functions.invoke("store-activate-license", {
      body: { product_slug: "snip-ai", license_key: key, device_id: deviceId() },
      signal: controller.signal,
    });
    if (error) {
      let detail=data?.error;
      try { detail ||= (await error.context?.json())?.error; } catch { /* retain the transport message */ }
      throw new Error(detail || error.message || "License activation failed.");
    }
    if (!data?.active || data.product_slug !== "snip-ai") throw new Error(data?.error || "This key could not activate Snip AI.");
    const stored: StoredLicense = { active: true, productSlug: "snip-ai", keyLast4: String(data.key_last4 || key.slice(-4)), activatedAt: new Date().toISOString() };
    localStorage.setItem(STATE_KEY, JSON.stringify(stored));
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Activation timed out. Check your internet connection and try again.");
    throw error;
  } finally { window.clearTimeout(timeout); }
}

export async function releaseThisDevice(licenseKey: string) {
  const key=licenseKey.trim().toUpperCase();
  const state=getStoredLicenseState();
  if(!key || (state.keyLast4 && !key.endsWith(state.keyLast4)))throw new Error('Enter the key currently active on this computer.');
  const {data,error}=await supabase.functions.invoke('store-release-license',{body:{product_slug:'snip-ai',license_key:key,device_id:deviceId()},signal:AbortSignal.timeout(20000)});
  if(error || !data?.released){let message=data?.error;try{message ||= (await error?.context?.json())?.error;}catch{}throw new Error(message || 'Could not release this device. Check your connection and try again.');}
  localStorage.removeItem(STATE_KEY);
  window.dispatchEvent(new Event('snip-license-changed'));
}
