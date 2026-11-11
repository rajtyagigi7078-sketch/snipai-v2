const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMediaBackend}=require('./media.cjs');
test('a damaged runtime is rejected before attempting media processing',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'snip-runtime-gate-'));
 try{
  for(const file of ['python/python.exe','pipeline/pipeline_runner.py','node/node.exe','ffmpeg/ffmpeg.exe','ffmpeg/ffprobe.exe']){const target=path.join(folder,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'not an executable');}
  const backend=createMediaBackend({runtimeRoot:folder,userData:folder,downloads:folder});
  await assert.rejects(backend.invoke('check_runtime',{}),error=>error.message.includes('RUNTIME_DEPENDENCY:')&&error.message.includes('python/msvcp140.dll'));
  await assert.rejects(backend.invoke('create_clips',{}),/RUNTIME_DEPENDENCY:/);
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
