const {test}=require('node:test');
const assert=require('node:assert/strict');
test('filenames and model paths cannot advance the generation stage',async()=>{
  const {pipelineStageFromLine}=await import('../src/lib/pipelineStatus.ts');
  for(const line of ['Output: C:\\Users\\Downloads\\Snip AI Clips\\run-123','C:\\runtime\\whisper_transcribe.py','Video: my-best-moments-render-caption.mp4'])assert.equal(pipelineStageFromLine(line),null);
});
test('real pipeline headers advance the correct steps',async()=>{
  const {pipelineStageFromLine}=await import('../src/lib/pipelineStatus.ts');
  assert.equal(pipelineStageFromLine('WHISPER TRANSCRIPTION'),1);
  assert.equal(pipelineStageFromLine('SNIP AI — STORY EVENT MAP V3 OPTIMIZED'),2);
  assert.equal(pipelineStageFromLine('PARALLEL RENDERING'),3);
  assert.equal(pipelineStageFromLine('[RUN] FFMPEG FRAME+CAPTION RENDER'),4);
});
test('empty speech result has an actionable message instead of an IPC stack',async()=>{
  const {generationErrorMessage}=await import('../src/lib/pipelineStatus.ts');
  const message=generationErrorMessage(new Error("Error invoking remote method 'snipai:invoke': Error: Process failed\nASR_NO_SPEECH: No clear spoken voice was detected."));
  assert.match(message,/clear English or Hindi-English dialogue/);assert.doesNotMatch(message,/Process failed|snipai:invoke/);
});
test('zero candidate results explain unsupported music and gameplay',async()=>{
  const {generationErrorMessage}=await import('../src/lib/pipelineStatus.ts');
  for(const message of ['ASR_NO_MOMENTS: No clip moments were found. The story analyzer received 3 timed words.', 'No clip moments were found.']){
    assert.match(generationErrorMessage(message),/gameplay without spoken commentary/);
    assert.doesNotMatch(generationErrorMessage(message),/Process failed|ASR_NO_MOMENTS/);
  }
});
