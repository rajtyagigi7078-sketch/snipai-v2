const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
async function main(){
 const root=path.resolve('.build/macos-runtime'), work=path.resolve('.build/mac-e2e');fs.mkdirSync(work,{recursive:true});
 const ffmpeg=path.join(root,'ffmpeg/ffmpeg'),audio=path.join(work,'speech.aiff'),video=path.join(work,'source.mp4');
 execFileSync('/usr/bin/say',['-o',audio,'-r','145','Here is one simple way to make better videos. Start with a clear question that your audience cares about. Then explain the answer with a real example. Keep each sentence focused on one idea. Remove long pauses and unnecessary repetition. A strong ending should help the viewer understand what to do next. You can improve your next video by following these steps today.']);
 execFileSync(ffmpeg,['-y','-f','lavfi','-i','testsrc2=size=640x360:rate=24','-i',audio,'-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video],{stdio:'inherit'});
 process.env.HF_HUB_OFFLINE='1';process.env.TRANSFORMERS_OFFLINE='1';process.env.HF_HOME=path.join(work,'empty-cache');
 const backend=require('../electron/media.cjs').createMediaBackend({runtimeRoot:root,userData:path.join(work,'user'),downloads:work,send:(event,data)=>console.log(event,data)});
 assert.ok((await backend.invoke('check_runtime',{})).ok);
 const results=[];
 for(const format of ['9:16','1:1','16:9']){
  const generated=await backend.invoke('create_clips',{inputPath:video,format,requestedClips:1,clipDurationSeconds:15,captionTemplate:format==='16:9'?'none':'pop',differentCaptions:false,audioLanguage:'english',captionOverrides:'{}'});
  assert.equal(generated.paths.length,1);
  const editor=await backend.invoke('read_clip_editor',{path:generated.paths[0]});assert.ok(editor.words.length>5);
  const exports=await backend.invoke('export_clips',{inputPaths:generated.paths,destinationDir:path.join(work,'exports',format.replace(':','-'))});
  const probe=await backend.probe(exports[0]);assert.ok(probe.hasAudio);assert.ok(probe.duration>5);
  results.push({format,export:exports[0],width:probe.width,height:probe.height,duration:probe.duration,words:editor.words.length});
 }
 fs.writeFileSync('macos-e2e-report.json',JSON.stringify({ok:true,arch:process.arch,results},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
