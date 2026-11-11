import { app, BrowserWindow, dialog, ipcMain, shell, protocol, net, powerMonitor, powerSaveBlocker } from "electron";
import { join, resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimeRoot = app.isPackaged ? join(process.resourcesPath, "windows-runtime") : join(rootDir, ".build", "windows-runtime");
let win;
let backend;
let systemSuspended = false;
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
const mediaExtensions = new Set(['.mp4','.mov','.mkv','.webm','.avi','.png','.jpg','.jpeg','.webp','.wav','.mp3']);
protocol.registerSchemesAsPrivileged([{scheme:'snip-media',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true,corsEnabled:true}}]);

function log(message) {
  mkdirSync(app.getPath('userData'),{recursive:true});
  appendFileSync(join(app.getPath('userData'), 'desktop.log'), `${new Date().toISOString()} ${message}\n`);
}
process.on('uncaughtException', error => { log(error.stack || String(error)); dialog.showErrorBox('Snip AI',error.message); });
process.on('unhandledRejection', error => log(`Unhandled: ${error?.stack || error}`));

async function createWindow() {
  win = new BrowserWindow({
    title:'Snip AI', width:1440,height:920,minWidth:1100,minHeight:720,
    backgroundColor:'#050505',show:false,icon:join(rootDir,'dist','snip-logo-mark.png'),
    webPreferences:{preload:join(rootDir,'electron','preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true},
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show',()=>win.show());
  win.webContents.on('did-fail-load',(_event,code,description,url)=>log(`Load failed ${code} ${description} ${url}`));
  win.webContents.on('console-message',(_event,...args)=>log(`Renderer ${args.map(x=>typeof x==='object'?JSON.stringify(x):String(x)).join(' ')}`));
  win.webContents.on('render-process-gone',(_event,details)=>log(`Renderer exited ${JSON.stringify(details)}`));
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//.test(url))void shell.openExternal(url);return{action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('file://')&&!url.startsWith('http://localhost:1420')&&!url.startsWith('http://127.0.0.1:1420'))event.preventDefault();});
  const devUrl = !app.isPackaged && process.env.SNIPAI_DEV_SERVER_URL;
  if(devUrl)await win.loadURL(devUrl);else await win.loadFile(join(rootDir,'dist','index.html'));
  log('Renderer document loaded');
}

app.whenReady().then(async()=>{
  protocol.handle('snip-media',async request=>{
    const uri=new URL(request.url), target=uri.searchParams.get('path');
    if(uri.host!=='local'||!target||!mediaExtensions.has(extname(target).toLowerCase())||!existsSync(target))return new Response('Media unavailable',{status:404});
    return net.fetch(pathToFileURL(target).href,{headers:request.headers});
  });
  const mediaModule = require('./media.cjs');
  powerMonitor.on('suspend',()=>{systemSuspended=true;log('System suspended; media deadlines paused.');});
  powerMonitor.on('resume',()=>{systemSuspended=false;log('System resumed; media deadlines resumed.');});
  backend = mediaModule.createMediaBackend({runtimeRoot,userData:app.getPath('userData'),downloads:app.getPath('downloads'),isSuspended:()=>systemSuspended,send:(event,payload)=>{if(win&&!win.isDestroyed())win.webContents.send(event,payload);}});
  ipcMain.handle('snipai:invoke',async(_event,command,args)=>{
    if(command==='legacy_license_candidate'){
      const candidate=await require('./license-migration.cjs').readLegacyLicenseCandidate();
      return candidate?{deviceId:candidate.deviceId,keyLast4:candidate.keyLast4}:null;
    }
    const started = Date.now();
    const powerBlock = ['create_clips','download_youtube','render_clip_edit','read_clip_editor'].includes(command) ? powerSaveBlocker.start('prevent-app-suspension') : null;
    log(`Media command started: ${command}`);
    try {
      const result = await backend.invoke(command,args);
      log(`Media command completed: ${command} in ${Date.now()-started}ms`);
      return result;
    } catch(error) {
      log(`Media command failed: ${command}: ${error?.stack || error}`);
      throw error;
    } finally {
      if(powerBlock !== null && powerSaveBlocker.isStarted(powerBlock))powerSaveBlocker.stop(powerBlock);
    }
  });
  ipcMain.on('snipai:ui-ready',(_event,screen)=>{
    log(`UI ready: ${screen}`);
    if(process.env.SNIPAI_SMOKE_REPORT_DIR&&win){
      const folder=resolve(process.env.SNIPAI_SMOKE_REPORT_DIR);mkdirSync(folder,{recursive:true});
      writeFileSync(join(folder,'ui-ready.json'),JSON.stringify({screen,version:app.getVersion(),packaged:app.isPackaged,at:new Date().toISOString()}));
      setTimeout(async()=>{if(win&&!win.isDestroyed()){try{const image=await win.webContents.capturePage();writeFileSync(join(folder,'electron-ui.png'),image.toPNG());}catch(error){log(`QA capture failed: ${error.message}`);}}},2500);
    }
  });
  ipcMain.handle('snipai:dialog',async(_event,options={})=>{
    const result=await dialog.showOpenDialog(win,{title:String(options.title||'Choose a file'),properties:[options.directory?'openDirectory':'openFile',...(options.multiple?['multiSelections']:[])],filters:options.directory?undefined:options.filters});
    return result.canceled?null:options.multiple?result.filePaths:result.filePaths[0]??null;
  });
  ipcMain.handle('snipai:open-path',(_event,target)=>shell.openPath(String(target)));
  ipcMain.handle('snipai:open-url',(_event,target)=>{const url=new URL(String(target));if(!['https:','mailto:'].includes(url.protocol))throw new Error('Unsupported link');return shell.openExternal(url.href);});
  ipcMain.handle('snipai:runtime-info',()=>({platform:process.platform,arch:process.arch,userData:app.getPath('userData')}));
  await createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)void createWindow();});
});
app.on('before-quit',()=>backend?.cancel?.());
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
