const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1366,height:768,webPreferences:{offscreen:true,backgroundThrottling:false}}),report=[];
 const run=s=>win.webContents.executeJavaScript(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
 for(const [width,height] of [[1366,768],[1100,720]]){
  win.setContentSize(width,height);await win.loadFile(path.resolve('.build/generation-layout-qa/index.html'));await wait(500);await run('window.qaShowError()');await wait(200);
  const bounds=await run(`(()=>{const e=document.querySelector('.processing-error'),p=e.querySelector('p').getBoundingClientRect(),g=document.querySelector('.generate-button').getBoundingClientRect(),b=e.getBoundingClientRect();return {top:b.top,bottom:b.bottom,summaryHeight:p.height,generateBottom:g.bottom,screen:innerHeight}})()`);
  if(bounds.summaryHeight<15||bounds.generateBottom>bounds.screen||bounds.bottom>bounds.screen)throw Error('Error panel is clipped: '+JSON.stringify(bounds));
  await run(`[...document.querySelectorAll('.processing-error button')].find(b=>b.textContent==='Error details').click()`);await wait(100);
  if(!await run(`document.querySelector('.generation-error-dialog').open && document.querySelector('.generation-error-dialog pre').textContent.includes('msvcp140.dll')`))throw Error('Diagnostic dialog missing');
  await run(`document.querySelector('.generation-error-dialog').close();[...document.querySelectorAll('.processing-error button')].find(b=>b.textContent==='Repair runtime').click()`);await wait(200);
  if(!await run(`document.querySelector('.processing-error').textContent.includes('Runtime checks passed')`))throw Error('Repair result was not shown');
  fs.writeFileSync('.build/generation-layout-qa/error-'+width+'.png',(await win.webContents.capturePage()).toPNG());report.push({width,height,...bounds});
 }
 fs.writeFileSync('.build/generation-layout-qa/error-report.json',JSON.stringify({pass:true,report},null,2));win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
