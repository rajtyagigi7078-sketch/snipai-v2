import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});

function makeKey(){
  const bytes=new Uint8Array(12); crypto.getRandomValues(bytes);
  const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let raw="";
  for(const b of bytes) raw+=alphabet[b%alphabet.length];
  return `SNIP-LIFE-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}`;
}
async function sha256(value:string){
  const data=new TextEncoder().encode(value.toUpperCase().trim());
  const digest=await crypto.subtle.digest("SHA-256",data);
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  try{
    const {order_id}=await req.json();
    if(!order_id) return json({error:"order_id is required."},400);

    const appId=Deno.env.get("CASHFREE_CLIENT_ID");
    const secret=Deno.env.get("CASHFREE_CLIENT_SECRET");
    const env=Deno.env.get("CASHFREE_ENVIRONMENT")||"sandbox";
    const supabaseUrl=Deno.env.get("SUPABASE_URL");
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!appId||!secret||!supabaseUrl||!serviceKey) return json({error:"Server is not configured."},500);

    const base=env==="production"?"https://api.cashfree.com":"https://sandbox.cashfree.com";
    const response=await fetch(`${base}/pg/orders/${encodeURIComponent(order_id)}/payments`,{
      headers:{"x-client-id":appId,"x-client-secret":secret,"x-api-version":"2025-01-01","Accept":"application/json"}
    });
    const payments=await response.json();
    if(!response.ok) return json({error:"Could not verify Cashfree order.",details:payments},502);

    const paid=Array.isArray(payments) && payments.some((p:any)=>p.payment_status==="SUCCESS");
    if(!paid) return json({paid:false,message:"Payment is not confirmed yet."});

    const admin=createClient(supabaseUrl,serviceKey);
    const {data:existing}=await admin.from("lifetime_license_keys").select("key_last4").eq("order_id",order_id).maybeSingle();
    if(existing) {
      return json({paid:true,license_key:null,key_last4:existing.key_last4,message:"Payment already processed. If you need the key again, contact support."});
    }

    const key=makeKey();
    const hash=await sha256(key);
    const {error}=await admin.from("lifetime_license_keys").insert({
      key_hash:hash,key_last4:key.slice(-4),status:"issued",order_id,amount_inr:100
    });
    if(error) {
      if(error.code==="23505") return json({paid:true,license_key:null,message:"Payment was already processed."});
      throw error;
    }

    return json({paid:true,license_key:key});
  }catch(e){return json({error:e instanceof Error?e.message:"Unexpected error."},500);}
});
