import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const offerEndsAt = "2026-11-12T09:47:22.456439+00:00";
const regularPrices: Record<string, number> = { "snip-ai": 300, capsnip: 450 };
const effectivePrice = (product: {slug: string; price_inr: number}) => Date.now() < Date.parse(offerEndsAt) ? Number(product.price_inr) : (regularPrices[product.slug] ?? Number(product.price_inr));


const headers = { "Access-Control-Allow-Origin": Deno.env.get("STORE_SITE_URL") || "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "GET, OPTIONS", "Content-Type": "application/json", "Cache-Control": "public, max-age=60" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "GET") return json({ error: "Method not allowed." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({ error: "Store catalog is not configured." }, 503);
    const result = await fetch(`${url}/rest/v1/store_products?select=slug,name,short_description,description,details,price_inr,icon,platform,features,screenshot_urls,download_url,release_label,is_active&is_active=eq.true&order=sort_order.asc`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const products = await result.json().catch(() => []);
    if (!result.ok) return json({ error: "Could not load the store catalog." }, 502);
    return json({ products: products.map((product: {slug:string;price_inr:number}) => ({ ...product, price_inr: effectivePrice(product), regular_price_inr: regularPrices[product.slug] ?? product.price_inr, offer_ends_at: offerEndsAt, offer_active: Date.now() < Date.parse(offerEndsAt) })) });
  } catch {
    return json({ error: "Could not load the store catalog." }, 500);
  }
});
