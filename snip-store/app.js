(() => {
  const offerEndsAt = "2026-11-12T09:47:22.456439+00:00";
  function updateOfferCountdown() { const node=document.getElementById("offerCountdown");if(!node)return;const remaining=new Date(offerEndsAt).getTime()-Date.now();if(remaining<=0){node.textContent="Offer ended";document.querySelectorAll(".regular-price").forEach(x=>x.remove());return}const days=Math.floor(remaining/86400000),hours=Math.floor(remaining/3600000)%24,minutes=Math.floor(remaining/60000)%60;node.textContent=`${days}d ${hours}h ${minutes}m left`;node.title=`Ends ${new Date(offerEndsAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})} IST`; }
  updateOfferCountdown();setInterval(updateOfferCountdown,30000);
  const config = window.SNIP_STORE_CONFIG || {};
  const SUPABASE_URL = String(config.supabaseUrl || "").replace(/\/$/, "");
  const PUBLISHABLE_KEY = String(config.publishableKey || "");
  const functionPrefix = config.functionPrefix || "/functions/v1/";
  const fallbackCatalog = [
    { slug:"snip-ai", name:"Snip AI", price_inr:100, short_description:"Turn long recordings into a set of short clips you can review and share.", description:"Snip AI helps creators find moments in long videos, prepare short clips, and review each result before export—all from a Windows desktop app.", icon:"S", features:[{title:"Find shareable moments",description:"Work through a long recording and prepare a set of short clips."},{title:"Choose your format",description:"Set clip format, language, caption theme, and clip count."},{title:"Review before export",description:"Preview generated clips, select the ones you want, and export."},{title:"Local desktop workflow",description:"Video processing and rendering run on your Windows computer."}], screenshots:["assets/snipai-04-generated-clips.png","assets/snipai-02-clip-setup.png","assets/snipai-01-video-import.png","assets/snipai-03-generation-progress.png"], download_url:"https://github.com/rajtyagigi7078-sketch/snipai-v2/releases/download/v0.1.5-windows-cpu/Snip-AI-0.1.5-Windows-CPU-setup.exe", release_label:"Snip AI v0.1.5 · Windows CPU installer",is_active:true},
    { slug:"capsnip", name:"Capsnip", price_inr:250, short_description:"Give every spoken line a look worth watching.", description:"Capsnip turns speech into editable captions. Choose from 68 styles, correct the transcript, adjust the look, and export a finished MP4 from your Windows desktop.", icon:"C", features:[{title:"English + Hinglish",description:"Transcribe speech locally, then edit timestamped lines."},{title:"68 caption styles",description:"Explore typography, Snip AI, mixed, and motion graphic themes."},{title:"Fine-tune the look",description:"Change fonts, colors, position, and size in the editor."},{title:"Export MP4",description:"Render a captioned video with your chosen frame and quality."}], screenshots:["assets/capsnip-editor-real.png","assets/capsnip-home-real.png","assets/capsnip-export-real.png"], download_url:"https://github.com/rajtyagigi7078-sketch/capsnip/releases/download/v0.1.1-windows-cpu/Capsnip-Windows-0.1.1-CPU.zip", release_label:"Capsnip v0.1.1 · Windows CPU package",is_active:true}
  ];
  const offerActive=()=>Date.now()<Date.parse(offerEndsAt);
  const normalizeProduct=product=>({...product,price_inr:offerActive()?product.price_inr:({"snip-ai":300,capsnip:450}[product.slug]||product.price_inr)});
  let catalog = fallbackCatalog.map(normalizeProduct);
  let selectedProduct = null;

  const byId = (id) => document.getElementById(id);
  const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;
  const functionsUrl = (name) => `${SUPABASE_URL}${functionPrefix}${name}`;
  const callFunction = async (name, payload, method = "POST") => {
    if (!SUPABASE_URL || !PUBLISHABLE_KEY) throw new Error("Snip Store is still being connected. Please try again shortly.");
    const response = await fetch(functionsUrl(name), {
      method,
      headers: { apikey:PUBLISHABLE_KEY, Authorization:`Bearer ${PUBLISHABLE_KEY}`, "Content-Type":"application/json" },
      ...(payload ? { body:JSON.stringify(payload) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status}).`);
    return data;
  };
  const safeCatalog = (items) => Array.isArray(items) ? items.filter(item => item && /^[a-z0-9-]+$/.test(item.slug) && item.is_active !== false) : [];
  const productLink = (slug) => `product.html?product=${encodeURIComponent(slug)}`;

  function renderCard(item) {
    const a = document.createElement("a"); a.className = "product-card"; a.href = productLink(item.slug); a.setAttribute("aria-label", `View ${item.name}`);
    const visual = document.createElement("div"); visual.className = "product-card-visual";
    const badge = document.createElement("span"); badge.className = "product-badge"; badge.textContent = "WINDOWS · LOCAL-FIRST"; visual.append(badge);
    const frame = document.createElement("div"); frame.className = "mock-frame real-shot-frame";
    const screenshots = item.screenshots || item.screenshot_urls || [];
    const image = document.createElement("img"); image.src = screenshots[0] || (item.slug === "capsnip" ? "assets/capsnip-editor-real.png" : "assets/snipai-04-generated-clips.png"); image.alt = `Real ${item.name} app screen`; image.loading = "lazy"; frame.append(image); visual.append(frame);
    const body = document.createElement("div"); body.className = "product-card-body";
    const row = document.createElement("div"); row.className = "card-title-row";
    const group = document.createElement("div"); group.className = "card-title-group";
    const icon = document.createElement("span"); icon.className = `card-icon ${item.slug}`; icon.textContent = item.icon || item.name.slice(0,1); group.append(icon);
    const title = document.createElement("h3"); title.textContent = item.name; group.append(title);
    const price = document.createElement("strong"); price.className = "price-tag"; price.textContent = money(item.price_inr); const regular=document.createElement("del");regular.className="regular-price";regular.textContent=money(item.slug==="snip-ai"?300:450);if(offerActive())price.prepend(regular); row.append(group,price);
    const desc = document.createElement("p"); desc.textContent = item.short_description || item.description || "A focused desktop app from Snip Store.";
    const meta = document.createElement("div"); meta.className = "card-meta";
    const caption = document.createElement("span"); caption.textContent = "Windows · local desktop app";
    const link = document.createElement("span"); link.className = "view-link"; link.textContent = "Explore app ↗"; meta.append(caption,link);
    body.append(row,desc,meta); a.append(visual,body); return a;
  }

  async function loadCatalog() {
    const grid = byId("productGrid");
    try { const data = await callFunction("store-catalog", null, "GET"); const items = safeCatalog(data.products); if (items.length) catalog = items.map(normalizeProduct); }
    catch (error) { console.info("Using the local Snip Store catalog preview.", error.message); }
    if(grid) grid.replaceChildren(...catalog.map(renderCard));
    if (byId("catalogStatus")) byId("catalogStatus").textContent = `${catalog.length} apps`;
  }

  function readFeatures(product) {
    const host = byId("featureList"); if (!host) return;
    const features = Array.isArray(product.features) ? product.features : (Array.isArray(product.feature_list) ? product.feature_list : []);
    host.replaceChildren();
    features.forEach((feature,index) => {
      const item = document.createElement("article"); item.className="feature-item";
      const number = document.createElement("span"); number.textContent=String(index+1).padStart(2,"0");
      const title = document.createElement("h3"); title.textContent=feature.title || feature.name || "Feature";
      const desc = document.createElement("p"); desc.textContent=feature.description || "A useful part of the desktop workflow.";
      item.append(number,title,desc); host.append(item);
    });
  }

  function initGallery(product) {
    const gallery = byId("screenshotGallery"); if (!gallery) return;
    const local = product.slug === "capsnip" ? ["assets/capsnip-editor-real.png","assets/capsnip-home-real.png","assets/capsnip-export-real.png"] : ["assets/snipai-01-video-import.png","assets/snipai-02-clip-setup.png","assets/snipai-04-generated-clips.png","assets/snipai-03-generation-progress.png"];
    const remote = Array.isArray(product.screenshots) ? product.screenshots : (Array.isArray(product.screenshot_urls) ? product.screenshot_urls : []);
    const images = [...remote,...local].filter(Boolean).slice(0,3);
    gallery.replaceChildren(...images.map((src,index) => {
      const figure=document.createElement("figure"),img=document.createElement("img"),caption=document.createElement("figcaption");
      const labels=product.slug==="capsnip"?["Caption templates in the editor","Project and clip workspace","MP4 export options"]:["Import a video","Choose clip settings","Review generated clips","Follow generation progress"];
      img.src=src;img.alt=`${product.name} ${labels[index]||"app screen"}`;img.loading="lazy";caption.textContent=labels[index]||`${product.name} app screen`;
      figure.append(img,caption);return figure;
    }));
    byId("galleryPrev")?.addEventListener("click",()=>gallery.scrollBy({left:-gallery.clientWidth,behavior:"smooth"}));
    byId("galleryNext")?.addEventListener("click",()=>gallery.scrollBy({left:gallery.clientWidth,behavior:"smooth"}));
  }

  function initProductPage() {
    const page=byId("productPage"); if(!page)return;
    const slug=new URLSearchParams(location.search).get("product")||"capsnip";
    const localProduct=fallbackCatalog.find(item=>item.slug===slug);
    const product=normalizeProduct(catalog.find(item=>item.slug===slug)||localProduct||{});
    if(!product){byId("productName").textContent="App not found";return}
    selectedProduct=product;
    document.title=`${product.name} — Snip Store`;
    const logo=byId("productLogo"); logo.textContent=product.icon||product.name.slice(0,1);logo.classList.toggle("snipai",product.slug==="snip-ai");
    byId("productName").textContent=product.name;
    byId("productShort").textContent=product.short_description||"Windows desktop · lifetime access";
    byId("productDescription").textContent=product.description||product.short_description||"A useful local desktop tool.";
    byId("productPrice").textContent=money(product.price_inr);const regular=document.createElement("del");regular.className="regular-price";regular.textContent=money(product.slug==="snip-ai"?300:450);if(offerActive())byId("productPrice").prepend(regular);byId("factPrice").textContent=`${money(product.price_inr)} once`;
    byId("purchasePrice").textContent=money(product.price_inr);byId("checkoutPrice").textContent=money(product.price_inr);byId("checkoutProduct").textContent=product.name;
    byId("detailsBlurb").textContent=product.details||product.description||product.short_description||"A focused desktop app that runs locally on your computer.";
    const mainScreenshot=byId("mainScreenshot"),productShots=Array.isArray(product.screenshots)?product.screenshots:(Array.isArray(product.screenshot_urls)?product.screenshot_urls:[]);mainScreenshot.src=productShots[0]||(product.slug==="capsnip"?"assets/capsnip-editor.svg":"assets/snipai-workspace.svg");mainScreenshot.alt=`${product.name} desktop workspace preview`;
    const buttons=[byId("buyButton"),byId("buyButtonBottom")].filter(Boolean);
    const available=typeof product.download_url==="string"&&/^https:\/\//i.test(product.download_url);
    buttons.forEach((button,index)=>{button.disabled=!available;if(!available){button.textContent="Windows installer coming soon";button.setAttribute("aria-describedby","productAvailability")}else button.addEventListener("click",()=>openCheckout(product));if(index===1&&available)button.textContent="Download & Get Key ↗"});
    const availability=byId("productAvailability");if(availability)availability.textContent=available?"Secure Cashfree checkout · installer and activation key after payment":"We’ll enable checkout when the Windows installer is ready.";
    readFeatures(product);initGallery(product);
  }

  function openCheckout(product) {
    if(typeof product?.download_url!=="string"||!/^https:\/\//i.test(product.download_url))return;
    selectedProduct=product;byId("checkoutProduct").textContent=product.name;byId("checkoutPrice").textContent=money(product.price_inr);byId("checkoutError").textContent="";
    const dialog=byId("checkoutDialog");if(dialog?.showModal)dialog.showModal();
  }

  async function startCheckout() {
    const email=byId("buyerEmail"),phone=byId("buyerPhone"),button=byId("payButton"),error=byId("checkoutError");
    if(!selectedProduct||!email?.reportValidity()||!phone?.reportValidity())return;
    button.disabled=true;button.textContent="Preparing secure checkout…";error.textContent="";
    try {
      const data=await callFunction("store-create-order",{product_slug:selectedProduct.slug,email:email.value.trim(),phone:phone.value.replace(/\D/g,"")});
      if(!data.payment_session_id||!data.order_id||!data.claim_token)throw new Error("Cashfree did not return a complete payment session.");
      sessionStorage.setItem(`snip-store-claim:${data.order_id}`,data.claim_token);
      sessionStorage.setItem(`snip-store-product:${data.order_id}`,selectedProduct.slug);
      const cashfree=window.Cashfree?window.Cashfree({mode:config.cashfreeMode||"sandbox"}):null;
      if(!cashfree)throw new Error("Cashfree checkout could not load. Check your connection and try again.");
      await cashfree.checkout({paymentSessionId:data.payment_session_id,redirectTarget:"_self"});
    } catch (err) {error.textContent=err?.message||"Could not open checkout.";button.disabled=false;button.innerHTML="Continue to secure payment <span>↗</span>";}
  }

  async function verifyPaymentReturn() {
    const card=byId("successCard");if(!card)return;
    const params=new URLSearchParams(location.search),orderId=params.get("order_id");
    const setState=(kind,eyebrow,title,message)=>{card.className=`success-card ${kind||""}`;byId("successEyebrow").textContent=eyebrow;byId("successTitle").textContent=title;byId("successMessage").textContent=message;byId("successMark").textContent=kind==="error"?"!":kind==="pending"?"…":"✓";};
    if(!orderId){setState("error","PAYMENT NOT CONFIRMED","We couldn’t find this order.","Open Snip Store and try again, or email snipaisupport@gmail.com with your Cashfree order details.");return}
    const claimToken=sessionStorage.getItem(`snip-store-claim:${orderId}`);
    if(!claimToken){setState("error","ORDER NEEDS HELP","Your browser session is missing.","For safety, activation keys are only shown to the browser that started checkout. Contact snipaisupport@gmail.com with your Cashfree order ID so we can help.");return}
    try {
      const data=await callFunction("store-verify-order",{order_id:orderId,claim_token:claimToken});
      if(!data.paid){setState("pending","PAYMENT PENDING","Cashfree hasn’t confirmed payment yet.",data.message||"Wait a little and refresh this page. No activation key will be issued until payment is verified.");return}
      setState("","PAYMENT CONFIRMED","Your app is ready.",`${data.product_name||"Your Snip app"} lifetime access is ready. Save this key and download the installer.`);
      const result=byId("successResult");result.hidden=false;result.replaceChildren();
      const label=document.createElement("div");label.className="result-label";label.textContent="YOUR ACTIVATION KEY";
      const key=document.createElement("div");key.className="activation-key";key.textContent=data.license_key||"Key already issued";
      const actions=document.createElement("div");actions.className="result-actions";
      const copy=document.createElement("button");copy.type="button";copy.textContent="Copy key";copy.addEventListener("click",async()=>{await navigator.clipboard.writeText(data.license_key);copy.textContent="Copied ✓";});actions.append(copy);
      if(data.license_key){const save=document.createElement("button");save.type="button";save.textContent="Download key .txt";save.addEventListener("click",()=>{const blob=new Blob([`${data.product_name||"Snip Store"} — Lifetime activation key\n\n${data.license_key}\n\nOrder: ${orderId}\nActivate once on your Windows computer. Keep this file private.\nSupport: snipaisupport@gmail.com\n`],{type:"text/plain;charset=utf-8"});const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`Snip-Store-${orderId}-activation-key.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});actions.append(save)}
      if(data.download_url){const download=document.createElement("a");download.href=data.download_url;download.setAttribute("download","");download.rel="noopener noreferrer";download.className="download-action";download.textContent="Download app ↗";actions.append(download)}else{const pending=document.createElement("span");pending.textContent="Download link coming soon";actions.append(pending)}
      const note=document.createElement("div");note.className="result-note";note.textContent="Keep your activation key somewhere safe. Enter it once when you open the desktop app.";
      result.append(label,key,actions,note);
    } catch(err) {setState("error","PAYMENT CHECK FAILED","We couldn’t finish verification.",err?.message||"Refresh this page in a moment. If the issue continues, contact snipaisupport@gmail.com.");}
  }

  byId("year")&&(byId("year").textContent=String(new Date().getFullYear()));
  byId("payButton")?.addEventListener("click",()=>void startCheckout());
  if(byId("productGrid"))void loadCatalog();
  if(byId("productPage")){loadCatalog().finally(initProductPage)}
  void verifyPaymentReturn();
})();
