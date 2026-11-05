import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
function bytesToBase64(bytes: Uint8Array) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const secret = Deno.env.get("CASHFREE_CLIENT_SECRET"), supabaseUrl = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const signature = req.headers.get("x-webhook-signature"), timestamp = req.headers.get("x-webhook-timestamp"), raw = await req.text();
    if (!secret || !supabaseUrl || !serviceKey || !signature || !timestamp) return json({ error: "Webhook is not configured." }, 503);
    const hmacKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const expected = bytesToBase64(new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(timestamp + raw))));
    if (expected !== signature) return json({ error: "Invalid webhook signature." }, 401);
    const event = JSON.parse(raw), orderId = String(event?.data?.order?.order_id || ""), payment = event?.data?.payment;
    if (!/^snip_[a-z0-9]+_[a-f0-9]{22}$/.test(orderId)) return json({ received: true });
    if (payment?.payment_status !== "SUCCESS") return json({ received: true });
    const dbHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const lookup = await fetch(`${supabaseUrl}/rest/v1/store_orders?select=amount_inr,status&order_id=eq.${encodeURIComponent(orderId)}&limit=1`, { headers: dbHeaders });
    const orders = await lookup.json().catch(() => []);
    if (!lookup.ok || !orders?.[0]) return json({ error: "Order record not found." }, 404);
    if (Number(payment.payment_amount) !== Number(orders[0].amount_inr)) return json({ error: "Payment amount does not match the order." }, 400);
    if (orders[0].status !== "paid") {
      const updated = await fetch(`${supabaseUrl}/rest/v1/store_orders?order_id=eq.${encodeURIComponent(orderId)}&status=neq.paid`, { method: "PATCH", headers: { ...dbHeaders, Prefer: "return=minimal" }, body: JSON.stringify({ status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
      if (!updated.ok) return json({ error: "Could not update the paid order." }, 502);
    }
    return json({ received: true });
  } catch {
    return json({ error: "Could not process the Cashfree webhook." }, 400);
  }
});
