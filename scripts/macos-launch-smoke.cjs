const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
async function main(){
 const release=path.resolve('release-mac');
 const directory=fs.readdirSync(release).find(name=>fs.existsSync(path.join(release,name,'Snip AI.app')));
 if(!directory)throw Error('Packaged Mac app is missing');
 const app=path.join(release,directory,'Snip AI.app');
 const report=path.resolve('.build/mac-ui-smoke');fs.mkdirSync(report,{recursive:true});
 const child=spawn(path.join(app,'Contents/MacOS/Snip AI'),[],{env:{...process.env,SNIPAI_SMOKE_REPORT_DIR:report},stdio:'inherit'});
 try{
  for(let i=0;i<60;i++){
   if(fs.existsSync(path.join(report,'electron-ui.png'))){console.log('PACKAGED_MAC_UI_PASS',fs.readFileSync(path.join(report,'ui-ready.json'),'utf8'));return;}
   if(child.exitCode!==null)throw Error('Packaged app exited before UI was ready');
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw Error('Packaged Mac app did not capture a ready UI within 60 seconds');
 }finally{child.kill('SIGTERM');}
}
main().catch(error=>{console.error(error);process.exitCode=1});
