import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status=200) =>
  new Response(JSON.stringify(body), { status, headers: {...cors, "Content-Type":"application/json"} });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers:cors});
  try {
    const { email, phone, websiteUrl } = await req.json();
    if (!email || !phone) return json({error:"Email and phone are required."},400);

    const appId = Deno.env.get("CASHFREE_CLIENT_ID");
    const secret = Deno.env.get("CASHFREE_CLIENT_SECRET");
    const env = Deno.env.get("CASHFREE_ENVIRONMENT") || "sandbox";
    const site = (websiteUrl || Deno.env.get("LICENSE_WEBSITE_URL") || "").replace(/\/$/,"");
    if (!appId || !secret || !site) return json({error:"Payment service is not configured."},500);

    const base = env === "production" ? "https://api.cashfree.com" : "https://sandbox.cashfree.com";
    const orderId = `snip_life_${crypto.randomUUID().replaceAll("-","").slice(0,24)}`;

    const cf = await fetch(`${base}/pg/orders`, {
      method:"POST",
      headers:{
        "x-client-id":appId,
        "x-client-secret":secret,
        "x-api-version":"2025-01-01",
        "Content-Type":"application/json",
        "Accept":"application/json"
      },
      body:JSON.stringify({
        order_id:orderId,
        order_amount:100,
        order_currency:"INR",
        customer_details:{
          customer_id:`snip_${crypto.randomUUID().slice(0,18)}`,
          customer_phone:String(phone),
          customer_email:String(email)
        },
        order_meta:{
          return_url:`${site}/payment-success.html?order_id={order_id}`
        },
        order_note:"Snip AI Lifetime License"
      })
    });

    const data=await cf.json();
    if(!cf.ok) return json({error:data?.message || data?.type || "Cashfree order creation failed.",details:data},502);

    return json({order_id:orderId,payment_session_id:data.payment_session_id});
  } catch(e) {
    return json({error:e instanceof Error ? e.message : "Unexpected error."},500);
  }
});
