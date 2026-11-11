const fs=require('fs'),path=require('path'),assert=require('assert/strict'),asar=require('@electron/asar');
async function main(){
 const installed=path.resolve(process.argv[2]);
 const resources=path.join(installed,'resources'),runtimeRoot=path.join(resources,'windows-runtime');
 const work=path.join(installed,'verification');fs.mkdirSync(work,{recursive:true});
 const code=path.join(work,'app-code');asar.extractAll(path.join(resources,'app.asar'),code);
 assert.equal(JSON.parse(fs.readFileSync(path.join(code,'package.json'))).version,'0.2.10');
 process.env.PATH=[path.join(runtimeRoot,'python'),path.join(runtimeRoot,'node'),path.join(process.env.SystemRoot,'System32')].join(path.delimiter);
 process.env.HF_HOME=path.join(work,'empty-model-cache');process.env.HF_HUB_OFFLINE='1';process.env.TRANSFORMERS_OFFLINE='1';process.env.CUDA_VISIBLE_DEVICES='';
 const {createMediaBackend}=require(path.join(code,'electron/media.cjs'));
 const backend=createMediaBackend({runtimeRoot,rootDir:code,userData:path.join(work,'user-data'),downloads:work,send:(event,payload)=>{if(event==='pipeline-progress')console.log(payload)}});
 const runtime=await backend.invoke('check_runtime',{});assert.ok(runtime.ok);assert.equal(runtime.loaded_msvc.length,3);
 const samples=[{language:'hinglish',format:'9:16',source:path.resolve('.build/verification/user-video-90s.mp4'),theme:JSON.parse(fs.readFileSync('src/editor/capsnipCatalog.json','utf8'))[0].key},{language:'english',format:'1:1',source:path.resolve('.build/native-release-0210/english-video.mp4'),theme:'pop'},{language:'english',format:'16:9',source:path.resolve('.build/native-release-0210/english-video.mp4'),theme:'highlight-box'}];
 const results=[];
 for(const sample of samples){
  const result=await backend.invoke('create_clips',{inputPath:sample.source,format:sample.format,requestedClips:1,clipDurationSeconds:15,captionTemplate:sample.theme,differentCaptions:false,audioLanguage:sample.language,captionOverrides:'{}'});
  assert.ok(result.paths[0]);const data=await backend.invoke('read_clip_editor',{path:result.paths[0]});assert.ok(data.words.length>5);
  data.lineGroups[0].words[0].text='VERIFIED';
  const settings={...data.settings,caption:{...(data.settings?.caption||{}),theme:'pop',color:'#88DDFF',accentColor:'#E9A8FF',fontSize:58},globalCaptionPosition:{x:48,y:63},linePositions:{},logo:{src:path.resolve('public/snip-logo-mark.png'),position:{x:85,y:12},scale:12,opacity:1},onScreenText:[{id:'release-test',text:'SNIP AI VERIFIED',styleId:'pop',color:'#FFFFFF',position:{x:50,y:20},scale:1,opacity:1}]};
  const edited=await backend.invoke('render_clip_edit',{path:result.paths[0],settings,words:data.lineGroups.flatMap(g=>g.words),lineGroups:data.lineGroups});
  const exported=await backend.invoke('export_clips',{inputPaths:[edited],destinationDir:path.join(work,'exports')});const info=await backend.probe(exported[0]);assert.ok(info.hasAudio);assert.ok(Math.abs(info.duration-15)<.2);
  const restored=await backend.invoke('read_clip_editor',{path:edited});assert.equal(restored.words[0].text,'VERIFIED');assert.equal(restored.settings.logo.scale,12);
  results.push({language:sample.language,requestedFormat:sample.format,words:data.words.length,exported:exported[0],duration:info.duration,audio:info.hasAudio});
 }
 const report={pass:true,version:'0.2.10',actualInstallerPayload:true,offline:true,restrictedPath:true,runtime,results};fs.writeFileSync(path.join(work,'report.json'),JSON.stringify(report,null,2));console.log('NATIVE_RELEASE_PASS',JSON.stringify(report));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
