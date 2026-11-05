import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const headers = { "Access-Control-Allow-Origin": Deno.env.get("STORE_SITE_URL") || "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
const bytesToHex = (bytes: Uint8Array) => Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
async function makeLicenseKey(orderId: string, slug: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${slug}:${orderId}`)));
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const raw = Array.from(bytes.slice(0, 15), (byte) => alphabet[byte & 31]).join("");
  const groups = raw.match(/.{1,5}/g) || [];
  return `SNIP-${slug === "snip-ai" ? "AI" : "CAP"}-${groups.join("-")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const { order_id, claim_token } = await req.json();
    const orderId = String(order_id || "").trim(), token = String(claim_token || "").trim();
    if (!/^snip_[a-z0-9]+_[a-f0-9]{22}$/.test(orderId) || !/^[a-f0-9]{64}$/.test(token)) return json({ error: "This order link is not valid." }, 400);
    const supabaseUrl = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const cashfreeId = Deno.env.get("CASHFREE_CLIENT_ID"), cashfreeSecret = Deno.env.get("CASHFREE_CLIENT_SECRET");
    const licenseSecret = Deno.env.get("STORE_LICENSE_SECRET"), environment = Deno.env.get("CASHFREE_ENVIRONMENT") || "sandbox";
    if (!supabaseUrl || !serviceKey || !cashfreeId || !cashfreeSecret || !licenseSecret) return json({ error: "The store license service is not configured yet." }, 503);
    const dbHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const orderResponse = await fetch(`${supabaseUrl}/rest/v1/store_orders?select=order_id,product_id,customer_email,amount_inr,currency,status,claim_token_hash&order_id=eq.${encodeURIComponent(orderId)}&limit=1`, { headers: dbHeaders });
    const orders = await orderResponse.json().catch(() => []);
    if (!orderResponse.ok || !Array.isArray(orders) || !orders[0]) return json({ error: "Order not found." }, 404);
    const order = orders[0];
    const suppliedHash = await sha256(token);
    if (suppliedHash !== order.claim_token_hash) return json({ error: "This order belongs to a different browser session." }, 403);
    const productResponse = await fetch(`${supabaseUrl}/rest/v1/store_products?select=slug,name,download_url,release_label&id=eq.${encodeURIComponent(order.product_id)}&limit=1`, { headers: dbHeaders });
    const products = await productResponse.json().catch(() => []);
    if (!productResponse.ok || !products?.[0]) return json({ error: "The product attached to this order was not found." }, 500);
    const product = products[0];

    if (order.status !== "paid") {
      const base = environment === "production" ? "https://api.cashfree.com" : "https://sandbox.cashfree.com";
      const cfHeaders = { "x-client-id": cashfreeId, "x-client-secret": cashfreeSecret, "x-api-version": "2025-01-01", Accept: "application/json" };
      const [cashOrderResponse, paymentResponse] = await Promise.all([
        fetch(`${base}/pg/orders/${encodeURIComponent(orderId)}`, { headers: cfHeaders }),
        fetch(`${base}/pg/orders/${encodeURIComponent(orderId)}/payments`, { headers: cfHeaders }),
      ]);
      const [cashOrder, payments] = await Promise.all([cashOrderResponse.json().catch(() => ({})), paymentResponse.json().catch(() => [])]);
      if (!cashOrderResponse.ok || !paymentResponse.ok) return json({ error: "Cashfree payment status could not be checked. Try again shortly." }, 502);
      const amountMatches = Number(cashOrder.order_amount) === Number(order.amount_inr) && cashOrder.order_currency === "INR";
      const paidPayment = Array.isArray(payments) && payments.some((payment) => payment.payment_status === "SUCCESS" && Number(payment.payment_amount) === Number(order.amount_inr));
      if (cashOrder.order_status !== "PAID" || !amountMatches || !paidPayment) return json({ paid: false, message: "Cashfree has not confirmed the full payment yet. Wait a moment and refresh this page." });
    }

    const licenseKey = await makeLicenseKey(orderId, product.slug, licenseSecret);
    const keyHash = await sha256(licenseKey.toUpperCase());
    const licenseInsert = await fetch(`${supabaseUrl}/rest/v1/store_licenses?on_conflict=order_id`, {
      method: "POST", headers: { ...dbHeaders, Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ product_id: order.product_id, order_id: orderId, key_hash: keyHash, key_last4: licenseKey.slice(-4), status: "issued" }),
    });
    if (!licenseInsert.ok) return json({ error: "Payment is confirmed, but key generation needs a retry. Refresh this page." }, 502);
    if (await sha256(licenseKey.toUpperCase()) !== await getStoredLicenseHash(supabaseUrl, serviceKey, orderId)) return json({ error: "The license key could not be recovered. Contact Snip Store support." }, 500);
    const paidUpdate = await fetch(`${supabaseUrl}/rest/v1/store_orders?order_id=eq.${encodeURIComponent(orderId)}&status=neq.paid`, { method: "PATCH", headers: { ...dbHeaders, Prefer: "return=minimal" }, body: JSON.stringify({ status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    if (!paidUpdate.ok) return json({ error: "Payment is confirmed, but order finalization needs a retry. Refresh this page." }, 502);
    return json({ paid: true, product_name: product.name, license_key: licenseKey, download_url: product.download_url, release_label: product.release_label });
  } catch (error) {
    console.error("Store payment verification failed:", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Could not verify this payment. Please refresh and try again." }, 500);
  }
});

async function getStoredLicenseHash(supabaseUrl: string, serviceKey: string, orderId: string) {
  const response = await fetch(`${supabaseUrl}/rest/v1/store_licenses?select=key_hash&order_id=eq.${encodeURIComponent(orderId)}&limit=1`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  const rows = await response.json().catch(() => []);
  if (!response.ok || !rows?.[0]?.key_hash) throw new Error("Issued license record is missing.");
  return rows[0].key_hash;
}
