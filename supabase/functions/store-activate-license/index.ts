import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Desktop shells use different local origins (Tauri/Electron). This endpoint
// accepts no browser session and binds the key to a device, so public CORS is OK.
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.toUpperCase().trim())))).map((byte) => byte.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const { product_slug, license_key, device_id } = await req.json();
    const slug = String(product_slug || "").trim().toLowerCase();
    const key = String(license_key || "").trim().toUpperCase();
    const deviceId = String(device_id || "").trim();
    const validPrefix = slug === "snip-ai" ? key.startsWith("SNIP-AI-") : slug === "capsnip" ? key.startsWith("SNIP-CAP-") : false;
    if (!validPrefix || !/^[A-Z0-9-]{20,48}$/.test(key) || !/^[a-f0-9-]{32,64}$/i.test(deviceId)) return json({ active: false, error: "Enter a valid activation key and try again." }, 400);
    const supabaseUrl = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ error: "The license service is not configured." }, 503);
    const headersDb = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const productResponse = await fetch(`${supabaseUrl}/rest/v1/store_products?select=id,slug&slug=eq.${encodeURIComponent(slug)}&is_active=eq.true&limit=1`, { headers: headersDb });
    const products = await productResponse.json().catch(() => []);
    if (!productResponse.ok || !products?.[0]) return json({ error: "This app is not available for activation." }, 404);
    const productId = products[0].id, keyHash = await sha256(key), deviceHash = await sha256(deviceId);
    const lookup = await fetch(`${supabaseUrl}/rest/v1/store_licenses?select=id,status,device_hash,key_last4&product_id=eq.${encodeURIComponent(productId)}&key_hash=eq.${keyHash}&limit=1`, { headers: headersDb });
    const rows = await lookup.json().catch(() => []);
    if (!lookup.ok) return json({ error: "Could not contact the license service." }, 502);
    const license = rows?.[0];
    if (license?.status === "revoked") return json({ active: false, error: "This license has been revoked. Contact Snip Store support." }, 403);
    if (license) {
      if (license.device_hash && license.device_hash !== deviceHash) return json({ active: false, error: "This key is already active on another installation. Contact support to move it." }, 409);
    } else {
      return json({ active: false, error: "This key was not found. Check the app and key, then try again." }, 404);
    }
    if (license && !license.device_hash) {
      const bind = await fetch(`${supabaseUrl}/rest/v1/store_licenses?id=eq.${encodeURIComponent(license.id)}&device_hash=is.null`, {
        method: "PATCH", headers: { ...headersDb, Prefer: "return=representation" },
        body: JSON.stringify({ status: "active", device_hash: deviceHash, activated_at: new Date().toISOString() }),
      });
      if (!bind.ok) return json({ error: "Could not activate this key. Please try again." }, 502);
      const boundRows = await bind.json().catch(() => []);
      if (!boundRows?.length) return json({ active: false, error: "This key is already active on another installation. Contact support to move it." }, 409);
    }
    return json({ active: true, product_slug: slug, key_last4: license.key_last4, license_id: license.id, device_id: deviceId, lifetime: true });
  } catch {
    return json({ error: "Could not activate this key. Please try again." }, 500);
  }
});
