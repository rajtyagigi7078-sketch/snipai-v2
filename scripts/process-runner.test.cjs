const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runProcess } = require('../electron/process-runner.cjs');
test('success drains output and resolves once', async () => {
  const lines=[];
  const result=await runProcess(process.execPath,['-e','console.log("complete")'],{onLine:line=>lines.push(line)});
  assert.match(result.stdout,/complete/); assert.deepEqual(lines,['complete']);
});
test('failed encoder rejects instead of leaving generation pending', async () => {
  await assert.rejects(runProcess(process.execPath,['-e','console.error("encoder failed");process.exit(7)']),/Process failed \(7\).*\nencoder failed/s);
});
test('silent stuck child is stopped and rejected', async () => {
  await assert.rejects(runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{idleTimeout:200}),/stopped reporting progress/);
});
test('exited parent with inherited descendant pipes still settles', async () => {
  const code='require("node:child_process").spawn(process.execPath,["-e","setTimeout(()=>{},5000)"],{stdio:["ignore",process.stdout,process.stderr],windowsHide:true}).unref();console.log("parent done");process.exit(0)';
  let exitedAt;
  const result=await runProcess(process.execPath,['-e',code],{exitDrainMs:100,onChild:child=>child?.once('exit',()=>{exitedAt=Date.now();})});
  assert.match(result.stdout,/parent done/); assert.ok(Date.now()-exitedAt<1000);
});
test('standby clock jump does not expire an otherwise healthy job', async () => {
  let offset=0;
  const jump=setTimeout(()=>{offset=35*60*1000;},100);
  try {
    const result=await runProcess(process.execPath,['-e','setTimeout(()=>console.log("resumed and completed"),500)'],{clock:()=>Date.now()+offset,timeout:5000,idleTimeout:4000});
    assert.match(result.stdout,/resumed and completed/);
  } finally {clearTimeout(jump);}
});
