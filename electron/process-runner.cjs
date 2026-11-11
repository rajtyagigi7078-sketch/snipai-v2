'use strict';
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

// A process can exit while a descendant still holds its stdout pipe open.
// Never leave the IPC promise pending just because `close` did not follow exit.
function runProcess(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { cwd, env, logPath, onLine, timeout = 0, idleTimeout = 0, onChild, isCancelled = () => false, isSuspended = () => false, clock = Date.now, exitDrainMs = 3000 } = options;
    const child = spawn(executable, args, { cwd, env: env || process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    onChild?.(child);
    let stdout = '', stderr = '', settled = false, activeMs = 0, lastOutputActiveMs = 0, lastTick = clock(), drainTimer;
    const stream = logPath ? fs.createWriteStream(logPath, { flags: 'a' }) : null;
    const readers = [];
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else child.kill('SIGKILL');
    };
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog); clearTimeout(drainTimer);
      for (const reader of readers) reader.close();
      child.stdout.destroy(); child.stderr.destroy();
      stream?.end();
      onChild?.(null, child);
      if (isCancelled()) error = new Error('Processing cancelled.');
      if (!error && code !== 0) error = new Error(`Process failed (${code}).${logPath ? ` Full log: ${logPath}` : ''}\n${(stderr || stdout).slice(-10000)}`);
      if (error) reject(error); else resolve({ stdout, stderr });
    };
    const fail = message => { stop(); finish(new Error(`${message}${logPath ? ` Full log: ${logPath}` : ''}`)); };
    const interval = Math.min(1000, timeout || Infinity, idleTimeout || Infinity);
    const watchdog = timeout || idleTimeout ? setInterval(() => {
      const now = clock(), delta = Math.max(0, now - lastTick); lastTick = now;
      // Modern Standby pauses both the worker and Electron. Do not charge
      // that suspended wall-clock time to either processing deadline.
      if (isSuspended() || delta > Math.max(10000, interval * 5)) { lastOutputActiveMs = activeMs; return; }
      activeMs += delta;
      if (timeout && activeMs >= timeout) fail('The media process exceeded its time limit. Please try again.');
      else if (idleTimeout && activeMs - lastOutputActiveMs > idleTimeout) fail('The media process stopped reporting progress. It has been stopped; please try again.');
    }, interval) : null;
    stream?.on('error', error => fail(`Could not write the processing log: ${error.message}`));
    const receive = (buffer, isError) => {
      lastOutputActiveMs = activeMs;
      if (isError) stderr = (stderr + buffer.toString('utf8')).slice(-256000);
      else stdout = (stdout + buffer.toString('utf8')).slice(-256000);
      stream?.write(buffer);
    };
    child.stdout.on('data', b => receive(b, false));
    child.stderr.on('data', b => receive(b, true));
    if (onLine) for (const input of [child.stdout, child.stderr]) {
      const reader = createInterface({ input });
      reader.on('line', line => { try { onLine(line); } catch (error) { fail(`Could not report processing progress: ${error.message}`); } });
      readers.push(reader);
    }
    child.once('error', error => finish(new Error(`Could not start bundled process: ${error.message}`)));
    child.once('exit', code => { if (!settled) drainTimer = setTimeout(() => finish(null, code), exitDrainMs); });
    child.once('close', code => finish(null, code));
  });
}
module.exports = { runProcess };
