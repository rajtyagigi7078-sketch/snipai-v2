'use strict';
// Runs the bundled media path using a source-video excerpt. No global runtimes.
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { createMediaBackend } = require('./media.cjs');
async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const runtimeRoot = path.join(rootDir, '.build', 'windows-runtime');
  const verification = path.join(rootDir, '.build', 'verification');
  fs.mkdirSync(verification, { recursive: true });
  const source = process.argv[2];
  if (!source || !fs.existsSync(source)) throw new Error('Supply an existing source video.');
  const input = path.join(verification, 'user-video-90s.mp4');
  if (!fs.existsSync(input)) {
    const result = spawnSync(path.join(runtimeRoot, 'ffmpeg', 'ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-t', '90', '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', input], { windowsHide: true, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  const backend = createMediaBackend({ runtimeRoot, rootDir, userData: path.join(verification, 'user-data'), downloads: verification, send: (event, payload) => console.log(event, payload) });
  const hardware = await backend.invoke('get_hardware_profile');
  console.log('HARDWARE_PROFILE', JSON.stringify(hardware));
  const result = await backend.invoke('create_clips', { inputPath: input, format: '16:9', requestedClips: 1, captionTemplate: process.env.SNIPAI_SMOKE_TEMPLATE || 'pop', differentCaptions: false, audioLanguage: 'hinglish', captionOverrides: '{}' });
  console.log('GENERATED_CLIPS', JSON.stringify(result));
  const clip = result.paths[0];
  const editor = await backend.invoke('read_clip_editor', { path: clip });
  console.log('EDITOR_DATA', JSON.stringify({ duration: editor.duration, width: editor.width, height: editor.height, wordCount: editor.words.length, lineCount: editor.lineGroups.length }));
  const edited = await backend.invoke('render_clip_edit', { path: clip, settings: { caption: { theme: 'kinetic', color: '#00FFFF', accentColor: '#FF00AA', fontSize: 48 }, globalCaptionPosition: { x: 40, y: 65 }, linePositions: { 'line-0': { x: 60, y: 45 } }, logo: null, onScreenText: [{ id: 'smoke', text: 'SNIP AI TEST', styleId: 'highlight-box', color: '#FFD84A', position: { x: 50, y: 20 }, scale: 1, opacity: 1 }] } });
  const editedInfo = await backend.probe(edited);
  if (!editedInfo.hasAudio || editedInfo.duration < 1) throw new Error('Edited output is missing audio or duration.');
  const exported = await backend.invoke('export_clips', { inputPaths: [edited], destinationDir: path.join(verification, 'exports') });
  const report = { source, excerpt: input, hardware, generated: result, editor: { duration: editor.duration, width: editor.width, height: editor.height, words: editor.words.length, lines: editor.lineGroups.length }, edited, export: exported, output: { duration: editedInfo.duration, width: editedInfo.width, height: editedInfo.height, audio: editedInfo.hasAudio } };
  fs.writeFileSync(path.join(verification, 'media-report.json'), JSON.stringify(report, null, 2));
  console.log('SMOKE_MEDIA_PASS', JSON.stringify(report));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
