'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { runProcess } = require('./process-runner.cjs');

const THEMES = ['pop', 'karaoke', 'bold-center', 'punch', 'minimal', 'highlight-box', 'typewriter', 'bounce', 'kinetic', 'podcast', 'yellow-stack', 'violet-pill', 'dual-line', 'bold-karaoke', 'soft-lyric'];
const FONTS = { pop: 'Poppins.ttf', karaoke: 'LeagueSpartan.ttf', 'bold-center': 'Anton.ttf', punch: 'AlfaSlabOne.ttf', minimal: 'Nunito.ttf', 'highlight-box': 'Kanit.ttf', typewriter: 'Teko.ttf', bounce: 'Rubik.ttf', kinetic: 'Oswald.ttf', podcast: 'BebasNeue.ttf', 'yellow-stack': 'Anton.ttf', 'violet-pill': 'Poppins.ttf', 'dual-line': 'Anton.ttf', 'bold-karaoke': 'Anton.ttf', 'soft-lyric': 'Nunito.ttf' };
const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
const color = (value, fallback = '#FFFFFF') => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
const escapePath = value => path.resolve(value).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''").replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]');

function createMediaBackend(options) {
  const { resourcesPath = process.resourcesPath, grantPath = () => {} } = options;
  const rootDir = options.rootDir || path.resolve(__dirname, '..');
  const emit = options.emit || options.send || (() => {});
  const app = options.app || { isPackaged: Boolean(process.resourcesPath), getPath: name => name === 'downloads' ? (options.downloads || path.join(options.userData, 'Clips')) : options.userData };
  let activeChild = null;
  let activeOperation = false;
  let cancelled = false;
  let runtimeReady = null;
  const runtimeRoot = () => {
    const candidates = [options.runtimeRoot, process.env.SNIP_AI_RUNTIME_ROOT, app.isPackaged && path.join(resourcesPath, 'windows-runtime'), path.join(rootDir, 'windows-runtime')].filter(Boolean);
    const result = candidates.find(p => fs.existsSync(path.join(p, 'python', 'python.exe')) && fs.existsSync(path.join(p, 'pipeline', 'pipeline_runner.py')));
    if (!result) throw new Error('The bundled Windows runtime is missing. Reinstall Snip AI; Python, FFmpeg and speech models must be included with the app.');
    return path.resolve(result);
  };
  function runtime() {
    const root = runtimeRoot();
    const result = { root, python: path.join(root, 'python', 'python.exe'), node: path.join(root, 'node', 'node.exe'), ffmpeg: path.join(root, 'ffmpeg', 'ffmpeg.exe'), ffprobe: path.join(root, 'ffmpeg', 'ffprobe.exe'), pipeline: path.join(root, 'pipeline') };
    for (const key of ['python', 'node', 'ffmpeg', 'ffprobe']) if (!fs.existsSync(result[key])) throw new Error(`Bundled ${key} runtime is missing: ${result[key]}`);
    return result;
  }
  const environment = rt => ({ ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', SNIP_AI_RUNTIME_ROOT: rt.root, SNIP_AI_PYTHON: rt.python, SNIP_AI_NODE: rt.node, SNIP_AI_FFMPEG: rt.ffmpeg, SNIP_AI_FFPROBE: rt.ffprobe, SNIP_AI_WHISPER_MODEL_DIR: path.join(rt.root, 'whisper-model'), SNIP_AI_WHISPER_MODEL: 'base', SNIP_AI_HINGLISH_ENGINE: 'swift', SNIP_AI_WHISPER_DEVICE: 'cpu', SNIP_AI_SWIFT_DEVICE: 'cpu', PATH: [path.dirname(rt.python), path.dirname(rt.ffmpeg), path.dirname(rt.node), process.env.PATH || ''].join(path.delimiter) });
  async function file(value, extensions) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Choose a local file first.');
    const resolved = path.resolve(value);
    const stat = await fsp.stat(resolved).catch(() => null);
    if (!stat?.isFile()) throw new Error(`File not found: ${resolved}`);
    if (extensions && !extensions.includes(path.extname(resolved).toLowerCase())) throw new Error('Unsupported file format.');
    grantPath(resolved);
    return resolved;
  }
  function run(executable, args, { cwd, env, logPath, onLine, track = false, timeout = 0 } = {}) {
    return runProcess(executable, args, { cwd, env, logPath, onLine, timeout,
      idleTimeout: track ? 15 * 60 * 1000 : 0,
      isSuspended: options.isSuspended,
      isCancelled: () => track && cancelled,
      onChild: (child, previous) => { if (track && child) activeChild = child; else if (activeChild === previous) activeChild = null; },
    });
  }
  async function ensureRuntime(force = false) {
    if (force) runtimeReady = null;
    if (!runtimeReady) runtimeReady = (async () => {
      const rt = runtime();
      for (const name of ['python/msvcp140.dll','python/vcruntime140.dll','python/vcruntime140_1.dll','node/msvcp140.dll','pipeline/runtime_check.py']) {
        if (!fs.existsSync(path.join(rt.root,name))) throw new Error(`Bundled file is missing: ${name}`);
      }
      const logDir=path.join(app.getPath('userData'),'diagnostics');
      await fsp.mkdir(logDir,{recursive:true});
      const result=await run(rt.python,[path.join(rt.pipeline,'runtime_check.py'),'--runtime',rt.root,'--output',path.join(logDir,'runtime-check.json')],{env:environment(rt),timeout:120000,track:activeOperation,logPath:path.join(logDir,'runtime-check.log')});
      const line=result.stdout.split(/\r?\n/).find(line=>line.startsWith('SNIP_RUNTIME_CHECK:'));
      const report=line && JSON.parse(line.slice('SNIP_RUNTIME_CHECK:'.length));
      if(!report?.ok)throw new Error('Bundled runtime checks did not complete.');
      return report;
    })();
    try { return await runtimeReady; }
    catch(error) { runtimeReady=null; if(cancelled)throw new Error('Processing cancelled.'); throw new Error(`RUNTIME_DEPENDENCY: Snip AI could not start its bundled engines. Use Repair runtime below; if a bundled file was removed, reinstall the latest Snip AI.\n${error.message}`); }
  }
  async function probe(value) {
    const target = await file(value);
    const rt = runtime();
    const result = await run(rt.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', target], { timeout: 20000 });
    const data = JSON.parse(result.stdout);
    const video = data.streams?.find(s => s.codec_type === 'video');
    if (!video || !(Number(data.format?.duration) > 0)) throw new Error('The selected file contains no playable video.');
    return { ...data, width: video.width, height: video.height, duration: Number(data.format.duration), hasAudio: data.streams.some(s => s.codec_type === 'audio') };
  }
  async function exclusive(operation) {
    if (activeOperation) throw new Error('Another media operation is already running.');
    activeOperation = true; cancelled = false;
    try { return await operation(); } finally { activeOperation = false; activeChild = null; cancelled = false; }
  }
  async function cancel() {
    cancelled = true;
    const child = activeChild;
    if (child?.pid) await new Promise(resolve => {
      const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      killer.once('close', resolve); killer.once('error', () => { child.kill(); resolve(); });
    });
    return null;
  }
  async function createClips(args) {
    await ensureRuntime();
    const input = await file(args.inputPath, ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v']);
    if (!['1:1', '16:9', '9:16'].includes(args.format)) throw new Error('Choose a supported video frame.');
    if (!['english', 'hinglish'].includes(args.audioLanguage)) throw new Error('Choose English or Hinglish.');
    const typographyTheme = String(args.captionTemplate || '').startsWith('capsnip:') ? require('./typography.cjs').catalog.find(t => t.key === args.captionTemplate) : null;
    if (!THEMES.includes(args.captionTemplate) && !typographyTheme) throw new Error(`Unsupported caption template: ${args.captionTemplate}`);
    const count = Number(args.requestedClips);
    if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('Choose between 1 and 10 clips.');
    const duration = args.clipDurationSeconds == null || args.clipDurationSeconds === 0 ? null : Number(args.clipDurationSeconds);
    if (duration !== null && (!Number.isInteger(duration) || duration < 10 || duration > 120)) throw new Error('Choose a clip length between 10 and 120 seconds, or Auto.');
    if (duration !== null && (await probe(input)).duration < duration) throw new Error('This video is shorter than the selected clip length. Choose a shorter length or Auto.');
    const rt = runtime();
    const outputDir = path.join(app.getPath('downloads'), 'Snip AI Clips', `run-${Date.now()}-${randomUUID().slice(0, 8)}`);
    await fsp.mkdir(outputDir, { recursive: true });
    const env = { ...environment(rt), SNIP_AI_OUTPUT_DIR: outputDir, SNIP_AI_WORK_DIR: path.join(outputDir, '.snip-ai-work'), SNIP_AI_TRANSCRIPT_CACHE_DIR: path.join(app.getPath('userData'), 'transcripts'), SNIP_AI_CLIP_DURATION_SECONDS: String(duration || 0), SNIP_AI_CAPTION_OVERRIDES_JSON: JSON.stringify(normalizeOverrides(args.captionOverrides)) };
    await run(rt.python, [path.join(rt.pipeline, 'pipeline_runner.py'), input, args.format, String(count), typographyTheme ? 'pop' : args.captionTemplate, String(Boolean(args.differentCaptions)), args.audioLanguage], { cwd: rt.pipeline, env, track: true, logPath: path.join(outputDir, 'pipeline.log'), onLine: line => emit('pipeline-progress', line) });
    const names = (await fsp.readdir(outputDir)).filter(n => /^snip_ai_simple_clip_\d+\.mp4$/i.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!names.length) throw new Error(`No clips were produced. See ${path.join(outputDir, 'pipeline.log')}`);
    let paths = names.map(n => path.join(outputDir, n));
    for (const clip of paths) await probe(clip);
    const selected = await readJson(path.join(outputDir, '.snip-ai-work', 'selected-generation.json'));
    await fsp.writeFile(path.join(outputDir, 'electron-job.json'), JSON.stringify({ inputPath: input, format: args.format, captionTemplate: args.captionTemplate, createdAt: new Date().toISOString() }));
    if (typographyTheme || args.autoScreenText || args.logoPath) {
      const rendered = [];
      const renderStarted = Date.now();
      const report = fraction => emit('pipeline-progress', 'SNIP_RENDER_PROGRESS:' + JSON.stringify(require('./render-progress.cjs').renderProgress(rendered.length, paths.length, fraction, (Date.now() - renderStarted) / 1000)));
      for (const clip of paths) {
        report(0);
        const editData=await clipEditorData(clip);
        const heading=editData.words.slice(0,6).map(word=>word.text).join(' ');
        const palette={pop:['#FFFFFF','#FFE500',64],karaoke:['#FFFFFF','#67E8F9',62],minimal:['#FFFFFF','#FFFFFF',48]};
        const standard=palette[args.captionTemplate] || ['#FFFFFF','#FFE500',64];
        rendered.push(await renderClipEdit({ path: clip, onProgress: report, settings: { caption: { theme: args.captionTemplate, color: typographyTheme?.baseColor || standard[0], accentColor: typographyTheme?.accent || standard[1], fontSize: typographyTheme?.size || standard[2] }, globalCaptionPosition: { x: 50, y: typographyTheme ? 72 : 62 }, linePositions: {}, onScreenText: args.autoScreenText ? [{id:randomUUID(),text:heading,styleId:'pop',color:'#FFFFFF',position:{x:50,y:16},scale:.8,opacity:1}] : [], logo: args.logoPath ? {src:args.logoPath,position:{x:86,y:10},scale:12,opacity:1} : null } }));
        report(0);
      }
      paths = rendered;
    }
    emit('pipeline-progress', 'SNIP_FINALIZING');
    const moments = selected.clips || [];
    const captions = moments.map(m => String(m.text || 'A standout moment worth sharing.').trim().slice(0, 140));
    return { paths, social_captions: paths.map((_, i) => captions[i] || 'A standout moment worth sharing.') };
  }
  function normalizeOverrides(raw) {
    let candidate;
    try { candidate = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {}; } catch { throw new Error('Caption appearance settings are invalid.'); }
    if (!candidate || Array.isArray(candidate) || typeof candidate !== 'object') throw new Error('Caption appearance settings must be an object.');
    const clean = {};
    for (const key of ['primaryColor', 'accentColor', 'titleColor', 'boxColor']) if (candidate[key] !== undefined) clean[key] = color(candidate[key]);
    for (const [key, min, max] of [['fontScale', 75, 150], ['verticalPosition', .35, .82], ['titleScale', 75, 150], ['titlePosition', .1, .9], ['lineHeightRatio', 1, 1.5], ['logoScale', 5, 35], ['logoOpacity', .2, 1], ['logoX', 0, 1], ['logoY', 0, 1]]) if (candidate[key] !== undefined) clean[key] = clamp(candidate[key], min, max, min);
    if (typeof candidate.titleText === 'string') clean.titleText = candidate.titleText.replace(/[\x00-\x1f]/g, ' ').slice(0, 120);
    if (['fade', 'side-reveal', 'blur-in', 'single'].includes(candidate.animation)) clean.animation = candidate.animation;
    if (candidate.logoPath) {
      if (!path.isAbsolute(candidate.logoPath) || !fs.existsSync(candidate.logoPath) || !['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(candidate.logoPath).toLowerCase())) throw new Error('Choose an existing PNG, JPEG or WebP logo.');
      clean.logoPath = candidate.logoPath;
    }
    return clean;
  }
  async function downloadYoutube(args) {
    const url = new URL(String(args.url || ''));
    if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) throw new Error('Enter a valid YouTube video URL.');
    const rt = runtime();
    const outputDir = path.join(app.getPath('downloads'), 'Snip AI Downloads', `download-${Date.now()}`);
    await fsp.mkdir(outputDir, { recursive: true });
    emit('youtube-download-progress', { percent: null, downloadedBytes: 0, totalBytes: null, speed: '', eta: '', stage: 'Reading video information' });
    // Read a small metadata response before the transfer, so the preview appears immediately.
    try {
      const metadata = await run(rt.python, ['-m', 'yt_dlp', '--js-runtimes', `node:${rt.node}`, '--no-playlist', '--skip-download', '--socket-timeout', '15', '--retries', '1', '--print', '%(title)j', '--print', '%(thumbnail)j', url.href], { env: environment(rt), track: true, timeout: 30000 });
      const values = metadata.stdout.trim().split(/\r?\n/).flatMap(line => { try { const value = JSON.parse(line); return typeof value === 'string' ? [value] : []; } catch { return []; } });
      if (values.length >= 2) emit('youtube-download-preview', { title: values[0], thumbnail: values[1] });
    } catch (error) { if (cancelled) throw error; /* A missing thumbnail must not prevent downloading. */ }
    const result = await run(rt.python, ['-m', 'yt_dlp', '--js-runtimes', `node:${rt.node}`, '--ffmpeg-location', rt.ffmpeg, '--no-playlist', '--newline', '--progress', '--socket-timeout', '20', '--retries', '2', '--fragment-retries', '2', '--progress-template', 'download:SNIP_PROGRESS:%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress._speed_str)s|%(progress._eta_str)s', '--format', 'bv*[height<=1080]+ba/b[height<=1080]/b', '--merge-output-format', 'mp4', '--restrict-filenames', '--print', 'after_move:filepath', '--output', path.join(outputDir, '%(title).100s-%(id)s.%(ext)s'), url.href], { env: environment(rt), track: true, logPath: path.join(outputDir, 'download.log'), onLine: line => {
      if (!line.includes('SNIP_PROGRESS:')) return;
      const [percent, downloaded, total, estimated, speed, eta] = line.split('SNIP_PROGRESS:')[1].split('|');
      emit('youtube-download-progress', { percent: parseFloat(percent) || 0, downloadedBytes: Number(downloaded) || 0, totalBytes: Number(total) || Number(estimated) || null, speed: speed || '', eta: eta || '', stage: 'Downloading video' });
    } });
    const found = result.stdout.split(/\r?\n/).map(s => s.trim()).reverse().find(s => path.isAbsolute(s) && fs.existsSync(s));
    if (!found) throw new Error(`Downloader did not return a video. See ${outputDir}`);
    await probe(found);
    emit('youtube-download-progress', { percent: 100, downloadedBytes: 0, totalBytes: null, speed: '', eta: '', stage: 'Download complete' });
    return found;
  }
  async function readJson(target) { try { return JSON.parse(await fsp.readFile(target, 'utf8')); } catch { return {}; } }
  async function clipEditorData(value) {
    const clipPath = await file(value, ['.mp4']);
    const info = await probe(clipPath);
    const saved = await readJson(`${clipPath}.editor.json`);
    if (saved.sourcePath && fs.existsSync(saved.sourcePath)) { grantPath(saved.sourcePath); return { ...saved, width: info.width, height: info.height, duration: info.duration }; }
    const outputDir = path.dirname(clipPath);
    const selected = await readJson(path.join(outputDir, '.snip-ai-work', 'selected-generation.json'));
    const job = await readJson(path.join(outputDir, 'electron-job.json'));
    const stem = path.parse(clipPath).name;
    const relative = await readJson(path.join(outputDir, '.snip_ai_tmp', `${stem}.ffmpeg.transcript.json`));
    let words = (relative.segments || []).flatMap(s => s.words || []).map(w => ({ text: String(w.text || w.word || '').trim(), start: Number(w.start), end: Number(w.end) })).filter(w => w.text && w.end > w.start);
    const index = Math.max(0, Number(stem.match(/clip_(\d+)/)?.[1] || 1) - 1);
    const moment = selected.clips?.[index];
    const original = job.inputPath || selected.video;
    if (!original || !moment || !fs.existsSync(original)) throw new Error('This clip has no editable source metadata. Generate a new clip set to edit captions without burning them twice.');
    const start = Number(moment.start ?? moment.start_time ?? moment.clip_start ?? moment.start_sec ?? 0);
    const end = Number(moment.end ?? moment.end_time ?? moment.clip_end ?? moment.end_sec);
    if (!(end > start)) throw new Error('The source clip timing is missing.');
    if (!words.length) {
      const transcript = await readJson(path.join(path.dirname(original), `${path.parse(original).name}.transcript.json`));
      words = (transcript.segments || []).flatMap(s => s.words || []).filter(w => Number(w.end) > start && Number(w.start) < end).map(w => ({ text: String(w.text || w.word || '').trim(), start: Math.max(0, Number(w.start) - start), end: Math.min(end - start, Number(w.end) - start) })).filter(w => w.text && w.end > w.start);
    }
    if (!words.length) throw new Error('Word timestamps are missing for this clip. Generate the clip again.');
    const work = path.join(outputDir, '.editor-work');
    await fsp.mkdir(work, { recursive: true });
    const clean = path.join(work, `${stem}.source.mp4`);
    if (!fs.existsSync(clean)) {
      const rt = runtime();
      const filter = job.format === '1:1' ? 'crop=min(iw\\,ih):min(iw\\,ih),scale=1080:1080,pad=1080:1920:0:440' : job.format === '9:16' ? 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1' : 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2';
      await run(rt.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-i', original, '-t', String(end - start), '-vf', filter, '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', clean], { track: true, logPath: path.join(work, 'editor-source.log'), onLine: line => emit('pipeline-progress', line) });
      await probe(clean);
    }
    const theme = job.captionTemplate || 'pop';
    const lineGroups = [];
    const engine = require(path.join(runtime().pipeline, 'ffmpeg-captions', 'engine.cjs'));
    const groupSize = engine.TEMPLATES[theme]?.wordsPerLine || 5;
    for (let i = 0; i < words.length; i += groupSize) {
      const group = words.slice(i, i + groupSize);
      lineGroups.push({ id: `line-${lineGroups.length}`, words: group, start: group[0].start, end: group[group.length - 1].end });
    }
    const data = { sourcePath: clean, words, lineGroups, duration: end - start, width: info.width, height: info.height, theme };
    await fsp.writeFile(`${clipPath}.editor.json`, JSON.stringify(data));
    grantPath(clean);
    return data;
  }
  const offsetFilter = (filter, dx = 0, dy = 0) => filter
    .replace(/(:x=|drawbox=x=)('([^']*)'|[^:,]+)/g, (_, prefix, value, quoted) => `${prefix}'(${quoted ?? value})+${dx.toFixed(3)}'`)
    .replace(/(:y=)('([^']*)'|[^:,]+)/g, (_, prefix, value, quoted) => `${prefix}'(${quoted ?? value})+${dy.toFixed(3)}'`);
  async function renderClipEdit(args) {
    const input = await file(args.path, ['.mp4']);
    const data = await clipEditorData(input);
    if (Array.isArray(args.words)) {
      if (!args.words.length || args.words.length > 10000) throw new Error('Transcript must contain between 1 and 10000 words.');
      const cleanWord = word => { const text=String(word.text || '').trim().slice(0,200),start=Number(word.start),end=Number(word.end); if(!text || !Number.isFinite(start) || !Number.isFinite(end) || start<0 || end<=start || end>data.duration+.1)throw new Error('Transcript word timing is invalid.');return {text,start,end}; };
      data.words=args.words.map(cleanWord);
      if(!Array.isArray(args.lineGroups) || args.lineGroups.length>10000)throw new Error('Transcript lines are missing.');
      data.lineGroups=args.lineGroups.map(group=>({id:String(group.id),start:Number(group.start),end:Number(group.end),words:group.words.map(cleanWord)}));
      if(JSON.stringify(data.lineGroups.flatMap(group=>group.words))!==JSON.stringify(data.words))throw new Error('Transcript lines do not match word edits.');
    }
    const settings = args.settings || {};
    const caption = settings.caption || {};
    const rt = runtime();
    const theme = caption.theme || data.theme || 'pop';
    const work = path.join(path.dirname(input), '.editor-work');
    await fsp.mkdir(work, { recursive: true });
    const runId = randomUUID().slice(0, 8);
    const out = path.join(path.dirname(input), `${path.parse(input).name}-edited-${runId}.mp4`);
    const position = settings.globalCaptionPosition || caption.position || { x: 50, y: 62 };
    const options = { template: theme, width: data.width, height: data.height, fontFile: path.join(rt.pipeline, 'fonts', FONTS[theme] || 'Anton.ttf'), secondaryFontFile: theme === 'dual-line' ? path.join(rt.pipeline, 'fonts', 'Nunito.ttf') : undefined, primaryColor: color(caption.color), accentColor: color(caption.accentColor, '#FFD84A'), fontSize: clamp(caption.fontSize, 8, 300, 72) * data.height / 1080, verticalPosition: clamp(position.y, 0, 100, 62) / 100 };
    let engine;
    if (theme.startsWith('capsnip:')) {
      engine = require('./typography.cjs');
      delete options.fontFile;
      options.fontSize = clamp(caption.fontSize, 8, 300, 72);
      options.globalCaptionPosition = position;
      options.linePositions = Object.fromEntries(Object.entries(settings.linePositions || {}).map(([key, value]) => [key.replace(/^line-/, ''), value]));
    } else {
      if (!THEMES.includes(theme)) throw new Error('Choose a supported caption style.');
      engine = require(path.join(rt.pipeline, 'ffmpeg-captions', 'engine.cjs'));
    }
    let filter;
    if (!theme.startsWith('capsnip:') && Object.keys(settings.linePositions || {}).length) {
      filter = data.lineGroups.map(group => {
        const p = settings.linePositions[group.id] || position;
        const built = engine.buildCaptionFilter(group.words, { ...options, verticalPosition: clamp(p.y, 0, 100, 62) / 100 });
        return offsetFilter(built.filter, (clamp(p.x, 0, 100, 50) - 50) / 100 * data.width);
      }).filter(Boolean).join(',');
    } else {
      const built = engine.buildCaptionFilter(data.words, options);
      filter = theme.startsWith('capsnip:') ? built.filter : offsetFilter(built.filter, (clamp(position.x, 0, 100, 50) - 50) / 100 * data.width);
    }
    for (const [index, text] of (settings.onScreenText || []).slice(0, 20).entries()) {
      const content = String(text.text || '').replace(/[\x00-\x1f]/g, ' ').slice(0, 500);
      if (!content) continue;
      const textPath = path.join(work, `overlay-${runId}-${index}.txt`);
      await fsp.writeFile(textPath, content, 'utf8');
      const font = path.join(rt.pipeline, 'fonts', FONTS[text.styleId] || 'Poppins.ttf');
      const size = Math.round(data.width * .055 * clamp(text.scale, .1, 5, 1));
      const x = clamp(text.position?.x, 0, 100, 50) / 100, y = clamp(text.position?.y, 0, 100, 25) / 100;
      const box = ['highlight-box', 'violet-pill', 'podcast'].includes(text.styleId) ? `:box=1:boxcolor=${text.styleId === 'violet-pill' ? '0x8B5CF6' : text.styleId === 'podcast' ? '0x161616' : '0x0F766E'}@.9:boxborderw=12` : '';
      filter += `${filter ? ',' : ''}drawtext=fontfile='${escapePath(font)}':textfile='${escapePath(textPath)}':expansion=none:fontcolor=${color(text.color).replace('#', '0x')}:fontsize=${size}:x='w*${x}-text_w/2':y='h*${y}-text_h/2':alpha=${clamp(text.opacity, 0, 1, 1)}${box}`;
    }
    const logo = settings.logo;
    let graph = `[0:v]${filter || 'null'}[captioned];`;
    const command = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-progress', 'pipe:1', '-stats_period', '1', '-y', '-i', data.sourcePath];
    if (logo?.src) {
      const logoPath = await file(logo.src, ['.png', '.jpg', '.jpeg', '.webp']);
      command.push('-loop', '1', '-framerate', '30', '-i', logoPath);
      const logoWidth = Math.round(data.width * clamp(logo.scale, 1, 80, 15) / 100);
      graph += `[1:v]scale=${logoWidth}:-1,format=rgba,colorchannelmixer=aa=${clamp(logo.opacity, 0, 1, 1)}[logo];[captioned][logo]overlay=x='main_w*${clamp(logo.position?.x, 0, 100, 85) / 100}-overlay_w/2':y='main_h*${clamp(logo.position?.y, 0, 100, 15) / 100}-overlay_h/2':shortest=1[vout]`;
    } else graph += '[captioned]null[vout]';
    const filterPath = path.join(work, `filters-${runId}.txt`);
    await fsp.writeFile(filterPath, graph);
    command.push('-t', String(data.duration), '-/filter_complex', filterPath, '-map', '[vout]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out);
    emit('pipeline-progress', 'Rendering your caption, logo and text changes…');
    await run(rt.ffmpeg, command, { track: true, timeout: Math.max(600000, data.duration * 30000), logPath: path.join(work, `render-${runId}.log`), onLine: line => {
      const time = line.match(/^out_time_us=(\d+)/);
      if (time) {
        const fraction = Math.max(0, Math.min(1, Number(time[1]) / 1e6 / data.duration));
        if (typeof args.onProgress === 'function') args.onProgress(fraction);
        else emit('pipeline-progress', `Rendering caption changes · ${Math.round(fraction * 100)}%`);
      } else if (!/^(frame|fps|stream_\d+_\d+_q|bitrate|total_size|out_time(?:_us|_ms)?|dup_frames|drop_frames|speed|progress)=/.test(line)) emit('pipeline-progress', line);
    } });
    await probe(out);
    await fsp.writeFile(`${out}.editor.json`, JSON.stringify({ ...data, settings }));
    grantPath(out);
    return out;
  }
  async function invoke(command, args = {}) {
    switch (command) {
      case 'create_clips': return exclusive(() => createClips(args));
      case 'download_youtube': return exclusive(() => downloadYoutube(args));
      case 'cancel_processing': return cancel();
      case 'check_runtime': return ensureRuntime(true);
      case 'read_clip_editor': return exclusive(() => clipEditorData(args.path));
      case 'render_clip_edit': return exclusive(() => renderClipEdit(args));
      case 'probe_video': return probe(args.path || args.inputPath);
      case 'get_hardware_profile': {
        const rt = runtime();
        const result = await run(rt.python, [path.join(rt.pipeline, 'hardware_profile.py'), ...(args.forceDetect ? ['--force'] : [])], { env: environment(rt), timeout: 30000 });
        const json = result.stdout.split(/\r?\n/).find(s => s.startsWith('SNIP_AI_HARDWARE_PROFILE='));
        if (!json) throw new Error('Hardware detection did not return a profile.');
        return JSON.parse(json.slice('SNIP_AI_HARDWARE_PROFILE='.length));
      }
      case 'export_clips': {
        if (!Array.isArray(args.inputPaths) || !args.inputPaths.length) throw new Error('Select clips to export.');
        if (!path.isAbsolute(String(args.destinationDir || ''))) throw new Error('Choose an export folder.');
        await fsp.mkdir(args.destinationDir, { recursive: true });
        const exported = [];
        for (const source of args.inputPaths) {
          const sourcePath = await file(source, ['.mp4']);
          let target = path.join(args.destinationDir, path.basename(sourcePath));
          if (path.resolve(target) !== sourcePath) {
            if (fs.existsSync(target)) target = path.join(args.destinationDir, `${path.parse(sourcePath).name}-${Date.now()}-${randomUUID().slice(0, 4)}.mp4`);
            await fsp.copyFile(sourcePath, target);
          }
          exported.push(target);
        }
        return exported;
      }
      default: throw new Error(`Unsupported desktop command: ${command}`);
    }
  }
  return { invoke, cancel, runtime, probe };
}

module.exports = { createMediaBackend, THEMES, FONTS };
