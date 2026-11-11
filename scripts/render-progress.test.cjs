const {test}=require('node:test');
const assert=require('node:assert/strict');
const {renderProgress}=require('../electron/render-progress.cjs');
test('caption batch advances continuously across all ten clips',()=>{
  let previous=75;
  for(let i=0;i<10;i++)for(const fraction of [0,.2,.7,1]){
    const p=renderProgress(i,10,fraction,30*(i+fraction));
    assert.ok(p.percent>=previous);assert.equal(p.current,i+1);previous=p.percent;
  }
  const done=renderProgress(10,10,0,300);
  assert.equal(done.completed,10);assert.equal(done.percent,98);assert.equal(done.etaSeconds,0);
});
test('remaining time follows measured work, not the source duration',()=>{
  const p=renderProgress(4,10,.5,135);
  assert.equal(p.etaSeconds,165);
  assert.equal(renderProgress(0,10,0,0).etaSeconds,null);
});
test('renderer accepts validated batch events and rejects broken events',async()=>{
  const {captionBatchProgress,pipelineStageFromLine}=await import('../src/lib/pipelineStatus.ts');
  assert.equal(captionBatchProgress('SNIP_RENDER_PROGRESS:'+JSON.stringify(renderProgress(7,10,.4,200))).current,8);
  for(const line of ['SNIP_RENDER_PROGRESS:bad','SNIP_RENDER_PROGRESS:{"total":0}','some filename'])assert.equal(captionBatchProgress(line),null);
  assert.equal(pipelineStageFromLine('SNIP_FINALIZING'),5);
});
