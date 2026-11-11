const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createMediaBackend}=require('./media.cjs');
async function main(){
  const root=path.resolve(__dirname,'..'), work=path.join(root,'.build/verification');
  const backend=createMediaBackend({runtimeRoot:path.join(root,'.build/windows-runtime'),userData:work,downloads:work});
  const report=JSON.parse(fs.readFileSync(path.join(work,'media-report.json'),'utf8'));
  const data=await backend.invoke('read_clip_editor',{path:report.edited});
  data.lineGroups[0].words[0].text='VERIFIED';
  const words=data.lineGroups.flatMap(line=>line.words);
  const settings={...data.settings,logo:{src:path.join(root,'public/snip-logo-mark.png'),position:{x:85,y:12},scale:12,opacity:1}};
  const output=await backend.invoke('render_clip_edit',{path:report.edited,settings,words,lineGroups:data.lineGroups});
  const restored=await backend.invoke('read_clip_editor',{path:output});
  assert.equal(restored.words[0].text,'VERIFIED');assert.equal(restored.settings.logo.scale,12);
  const exported=await backend.invoke('export_clips',{inputPaths:[output],destinationDir:path.join(work,'saved-exports')});
  assert.equal(fs.statSync(output).size,fs.statSync(exported[0]).size);
  const info=await backend.probe(exported[0]);assert.ok(info.hasAudio);
  console.log(JSON.stringify({pass:true,transcript:restored.words[0].text,logo:true,export:exported[0],audio:info.hasAudio}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
