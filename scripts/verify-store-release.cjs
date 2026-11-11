const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=path.resolve('snip-store');
const mock=`<script>window.Cashfree=()=>({checkout:async()=>({status:'success'})});const originalFetch=window.fetch;window.fetch=async(url,options={})=>{if(String(url).includes('/functions/v1/')){let value;if(String(url).includes('store-catalog'))throw Error('Use offline QA catalog');if(String(url).includes('store-create-order'))value={order_id:'qa_order',claim_token:'qa-private-token',payment_session_id:'qa-session'};else if(String(url).includes('store-verify-order')){window.qaVerifiedBody=JSON.parse(options.body);value=new URL(location.href).searchParams.has('pending')?{paid:false}:{paid:true,product_name:'Snip AI',license_key:'DEMO-NOT-A-REAL-LICENSE',download_url:'https://github.com/rajtyagigi7078-sketch/snipai-v2/releases/download/v0.2.9-windows-cpu/Snip-AI-0.2.9-Setup.exe'};}return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});}return originalFetch(url,options);};</script>`;
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname,filename=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)){res.writeHead(404);return res.end();}let content=fs.readFileSync(filename);const ext=path.extname(filename);res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[ext]||'application/octet-stream');if(ext==='.html')content=Buffer.from(content.toString().replace('<head>','<head>'+mock).replace('<script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>',''));res.end(content);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 let win=new BrowserWindow({show:false,width:1366,height:900,webPreferences:{offscreen:true,backgroundThrottling:false,partition:'store-release-qa'}});
 const run=async s=>{try{return await win.webContents.executeJavaScript(s)}catch(e){throw Error('QA expression failed: '+s.slice(0,220)+' '+e)}},wait=ms=>new Promise(r=>setTimeout(r,ms)),folder=path.resolve('.build/store-release-qa');fs.mkdirSync(folder,{recursive:true});const results=[];
 for(const route of ['index.html','product.html?product=snip-ai','product.html?product=capsnip']){
  await win.loadURL(base+'/'+route);await wait(700);await run('document.querySelectorAll("img").forEach(i=>i.loading="eager")');await wait(1000);
  const state=await run(`({styles:document.querySelectorAll('.typography-grid img').length,broken:[...document.images].filter(i=>!i.complete||!i.naturalWidth).map(i=>i.getAttribute('src')),overflow:document.documentElement.scrollWidth-innerWidth,support:!!document.querySelector('a[href*="mail.google.com"]')})`);
  assert.equal(state.styles,10);assert.equal(state.broken.length,0,JSON.stringify(state.broken));assert.ok(state.overflow<=1);assert.ok(state.support);results.push({route,...state});
  fs.writeFileSync(path.join(folder,route.includes('capsnip')?'capsnip.png':route.includes('product')?'snipai.png':'home.png'),(await win.webContents.capturePage()).toPNG());
 }
 await win.loadURL(base+'/product.html?product=snip-ai');await wait(500);
 await run(`document.querySelector('#buyButton').click();document.querySelector('#buyerEmail').value='qa@example.com';document.querySelector('#buyerPhone').value='9999999999';document.querySelector('#payButton').click();`);await wait(500);
 assert.equal(await run(`JSON.parse(localStorage.getItem('snip-store.purchases.v1'))[0].orderId`),'qa_order');
 win.destroy();win=new BrowserWindow({show:false,width:1366,height:900,webPreferences:{offscreen:true,backgroundThrottling:false,partition:'store-release-qa'}});
 await win.loadURL(base+'/payment-success.html?order_id=qa_order');await wait(500);
 assert.equal(await run(`window.qaVerifiedBody?.claim_token`),'qa-private-token');
 assert.equal(await run(`document.querySelector('.download-action').href.includes('v0.2.9-windows-cpu')`),true);
 assert.match(await run('document.querySelector(".result-note").textContent'),/Download key .txt/);
 fs.writeFileSync(path.join(folder,'success-qa.png'),(await win.webContents.capturePage()).toPNG());
 await win.loadURL(base+'/payment-success.html?order_id=qa_order&pending=1');await wait(400);assert.equal(await run('document.querySelector(".download-action")'),null);
 await run('localStorage.clear();sessionStorage.clear()');await win.loadURL(base+'/payment-success.html?order_id=qa_order');await wait(400);assert.equal(await run('document.querySelector(".download-action")'),null);assert.ok(await run('[...document.links].some(a=>a.href.includes("mail.google.com"))'));
 win.setContentSize(390,844);await win.loadURL(base+'/product.html?product=snip-ai');await wait(600);assert.ok(await run('document.documentElement.scrollWidth-innerWidth<=1'));
 fs.writeFileSync(path.join(folder,'mobile.png'),(await win.webContents.capturePage()).toPNG());
 fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify({pass:true,results,checkoutRecoveryAfterWindowClose:true,pendingPaymentHasNoDownload:true,missingTokenShowsSupport:true,mobileNoOverflow:true},null,2));win.destroy();server.close();app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
