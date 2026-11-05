import { supabase } from "./supabase";

const STATE_KEY = "snip-ai.store-license.v1";
const DEVICE_KEY = "snip-ai.install-id.v1";

export type LicenseState = { active: boolean; keyLast4?: string | null };

type StoredLicense = { active: true; productSlug: "snip-ai"; keyLast4: string; activatedAt: string };

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
    if (error) throw new Error(data?.error || error.message || "License activation failed.");
    if (!data?.active || data.product_slug !== "snip-ai") throw new Error(data?.error || "This key could not activate Snip AI.");
    const stored: StoredLicense = { active: true, productSlug: "snip-ai", keyLast4: String(data.key_last4 || key.slice(-4)), activatedAt: new Date().toISOString() };
    localStorage.setItem(STATE_KEY, JSON.stringify(stored));
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Activation timed out. Check your internet connection and try again.");
    throw error;
  } finally { window.clearTimeout(timeout); }
}
