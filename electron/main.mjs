import { app, BrowserWindow, dialog, ipcMain, shell, protocol, powerMonitor, powerSaveBlocker, safeStorage } from "electron";
import { join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimeRoot = app.isPackaged ? join(process.resourcesPath, "windows-runtime") : join(rootDir, ".build", "windows-runtime");
const uninstalling = process.platform === 'win32' && process.argv.includes('--release-license-on-uninstall');
const uninstallLicense = () => require('./uninstall-license.cjs').createUninstallLicense(app.getPath('userData'), safeStorage);
let win;
let backend;
let shutdown;
let readyToQuit = false;
let systemSuspended = false;
if(!uninstalling && !app.requestSingleInstanceLock())app.quit();
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
  win.on('close', event => {
    if (process.platform === 'darwin' || readyToQuit) return;
    event.preventDefault();
    app.quit();
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show',()=>win.show());
  win.webContents.on('did-fail-load',(_event,code,description,url)=>log(`Load failed ${code} ${description} ${url}`));
  win.webContents.on('console-message',(_event,...args)=>log(`Renderer ${args.map(x=>typeof x==='object'?JSON.stringify(x):String(x)).join(' ')}`));
  win.webContents.on('render-process-gone',(_event,details)=>{
    log(`Renderer exited ${JSON.stringify(details)}`);
    if (details.reason !== 'clean-exit') app.quit();
  });
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//.test(url))void shell.openExternal(url);return{action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('file://')&&!url.startsWith('http://localhost:1420')&&!url.startsWith('http://127.0.0.1:1420'))event.preventDefault();});
  const devUrl = !app.isPackaged && process.env.SNIPAI_DEV_SERVER_URL;
  if(devUrl)await win.loadURL(devUrl);else await win.loadFile(join(rootDir,'dist','index.html'));
  log('Renderer document loaded');
}

app.whenReady().then(async()=>{
  if (uninstalling) {
    try { await uninstallLicense().release(); app.exit(0); }
    catch { app.exit(1); }
    return;
  }
  protocol.handle('snip-media',async request=>{
    const uri=new URL(request.url), target=uri.searchParams.get('path');
    if(uri.host!=='local'||!target||!mediaExtensions.has(extname(target).toLowerCase())||!existsSync(target))return new Response('Media unavailable',{status:404});
    const file = await stat(target).catch(() => null);
    if (!file?.isFile()) return new Response(null, { status: 404 });
    const types = { mp4:'video/mp4', mov:'video/quicktime', mkv:'video/x-matroska', webm:'video/webm', avi:'video/x-msvideo', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', wav:'audio/wav', mp3:'audio/mpeg' };
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Content-Type': types[extname(target).slice(1).toLowerCase()],
    });
    const range = request.headers.get('range');
    let start = 0;
    let end = file.size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
      if (match?.[1]) {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      } else if (match?.[2]) {
        start = Math.max(0, file.size - Number(match[2]));
      }
      if (!match || (!match[1] && !match[2]) || start > end) {
        headers.set('Content-Range', `bytes */${file.size}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set('Content-Range', `bytes ${start}-${end}/${file.size}`);
    }
    headers.set('Content-Length', String(end - start + 1));
    const body = request.method === 'HEAD' || end < start ? null
      : Readable.toWeb(createReadStream(target, { start, end, signal: request.signal }));
    return new Response(body, { status: range ? 206 : 200, headers });
  });
  const mediaModule = require('./media.cjs');
  powerMonitor.on('suspend',()=>{systemSuspended=true;log('System suspended; media deadlines paused.');});
  powerMonitor.on('resume',()=>{systemSuspended=false;log('System resumed; media deadlines resumed.');});
  backend = mediaModule.createMediaBackend({runtimeRoot,userData:app.getPath('userData'),downloads:app.getPath('downloads'),isSuspended:()=>systemSuspended,send:(event,payload)=>{if(win&&!win.isDestroyed())win.webContents.send(event,payload);}});
  ipcMain.handle('snipai:invoke',async(_event,command,args)=>{
    if(command==='reset_workspace'){
      await backend.cancel();
      log('User requested workspace recovery restart; saved media and activation preserved.');
      setTimeout(()=>{app.relaunch();app.quit();},300);
      return true;
    }
    if(command==='repair_runtime'){
      const installer=join(runtimeRoot,'prerequisites','VC_redist.x64.exe');
      if(!existsSync(installer))throw new Error('The bundled repair installer is missing. Reinstall the latest Snip AI.');
      const literal=installer.replaceAll("'","''");
      const script=`$ErrorActionPreference='Stop'; $file='${literal}'; $signature=Get-AuthenticodeSignature -LiteralPath $file; if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation'){throw 'Microsoft signature verification failed'}; $p=Start-Process -FilePath $file -ArgumentList '/install','/passive','/norestart' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; if($p.ExitCode -notin @(0,3010,1638)){throw ('Runtime setup failed: '+$p.ExitCode)}`;
      await new Promise((resolve,reject)=>{
        const child=spawn(join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','ignore','pipe']});
        let detail='';child.stderr.on('data',b=>{detail=(detail+b.toString()).slice(-2000)});
        child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error('Runtime repair was cancelled or failed. '+detail)));
      });
      return backend.invoke('check_runtime',{});
    }
    if(command==='save_uninstall_license') {
      if (process.platform === 'win32') await uninstallLicense().save(args);
      return null;
    }
    if(command==='clear_uninstall_license') {
      if (process.platform === 'win32') await uninstallLicense().clear();
      return null;
    }
    if(command==='was_license_released') return existsSync(uninstallLicense().marker);
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
app.on('before-quit',event=>{
  if (!backend || readyToQuit) return;
  event.preventDefault();
  shutdown ??= backend.shutdown().catch(error=>log(`Shutdown failed: ${error.message}`)).finally(()=>{
    readyToQuit = true;
    app.quit();
  });
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
