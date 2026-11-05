import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const offerEndsAt = "2026-11-12T09:47:22.456439+00:00";
const regularPrices: Record<string, number> = { "snip-ai": 300, capsnip: 450 };
const effectivePrice = (product: {slug: string; price_inr: number}) => Date.now() < Date.parse(offerEndsAt) ? Number(product.price_inr) : (regularPrices[product.slug] ?? Number(product.price_inr));


const origin = Deno.env.get("STORE_SITE_URL") || "*";
const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const { product_slug, email, phone } = await req.json();
    const cleanSlug = String(product_slug || "").trim().toLowerCase();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPhone = String(phone || "").replace(/\D/g, "");
    if (!/^[a-z0-9-]{2,40}$/.test(cleanSlug)) return json({ error: "Choose a valid Snip Store app." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 254) return json({ error: "Enter a valid email address." }, 400);
    if (!/^\d{10,13}$/.test(cleanPhone)) return json({ error: "Enter a valid mobile number." }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const cashfreeId = Deno.env.get("CASHFREE_CLIENT_ID"), cashfreeSecret = Deno.env.get("CASHFREE_CLIENT_SECRET");
    const siteUrl = (Deno.env.get("STORE_SITE_URL") || "").replace(/\/$/, "");
    const environment = Deno.env.get("CASHFREE_ENVIRONMENT") || "sandbox";
    if (!supabaseUrl || !serviceKey || !cashfreeId || !cashfreeSecret || !siteUrl) return json({ error: "Store checkout is not configured yet." }, 503);
    const base = environment === "production" ? "https://api.cashfree.com" : "https://sandbox.cashfree.com";
    const dbHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const productResponse = await fetch(`${supabaseUrl}/rest/v1/store_products?select=id,slug,name,price_inr,is_active,download_url&slug=eq.${encodeURIComponent(cleanSlug)}&is_active=eq.true&limit=1`, { headers: dbHeaders });
    const products = await productResponse.json().catch(() => []);
    if (!productResponse.ok || !Array.isArray(products) || !products[0]) return json({ error: "This app is not available for purchase right now." }, 404);
    const product = products[0], amount = effectivePrice(product);
    if (typeof product.download_url !== "string" || !/^https:\/\//i.test(product.download_url)) return json({ error: "The Windows installer is not published yet. Please check back soon." }, 409);
    if (!Number.isInteger(amount) || amount < 1 || amount > 100000) return json({ error: "The app price is not configured correctly." }, 503);

    const orderId = `snip_${product.slug.replaceAll("-", "")}_${crypto.randomUUID().replaceAll("-", "").slice(0, 22)}`;
    const claimToken = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const claimHash = await sha256(claimToken);
    const insert = await fetch(`${supabaseUrl}/rest/v1/store_orders`, {
      method: "POST", headers: { ...dbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ order_id: orderId, product_id: product.id, customer_email: cleanEmail, customer_phone: cleanPhone, amount_inr: amount, status: "created", claim_token_hash: claimHash }),
    });
    if (!insert.ok) return json({ error: "Could not start your order. Please try again." }, 502);

    const customerId = `snip_${(await sha256(cleanEmail)).slice(0, 24)}`;
    const cashfreeResponse = await fetch(`${base}/pg/orders`, {
      method: "POST",
      headers: { "x-client-id": cashfreeId, "x-client-secret": cashfreeSecret, "x-api-version": "2025-01-01", "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ order_id: orderId, order_amount: amount, order_currency: "INR", customer_details: { customer_id: customerId, customer_phone: cleanPhone, customer_email: cleanEmail }, order_meta: { return_url: `${siteUrl}/payment-success.html?order_id={order_id}`, notify_url: `${supabaseUrl}/functions/v1/store-cashfree-webhook` }, order_note: `${product.name} lifetime access`, order_tags: { product: product.slug } }),
    });
    const checkout = await cashfreeResponse.json().catch(() => ({}));
    if (!cashfreeResponse.ok || !checkout.payment_session_id) {
      await fetch(`${supabaseUrl}/rest/v1/store_orders?order_id=eq.${encodeURIComponent(orderId)}`, { method: "PATCH", headers: { ...dbHeaders, Prefer: "return=minimal" }, body: JSON.stringify({ status: "failed", updated_at: new Date().toISOString() }) });
      return json({ error: checkout.message || "Cashfree could not create the payment session." }, 502);
    }
    await fetch(`${supabaseUrl}/rest/v1/store_orders?order_id=eq.${encodeURIComponent(orderId)}`, { method: "PATCH", headers: { ...dbHeaders, Prefer: "return=minimal" }, body: JSON.stringify({ status: "pending", payment_session_id: checkout.payment_session_id, updated_at: new Date().toISOString() }) });
    return json({ order_id: orderId, payment_session_id: checkout.payment_session_id, claim_token: claimToken, mode: environment });
  } catch (error) {
    console.error("Store order creation failed:", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Could not create checkout. Please try again." }, 500);
  }
});
