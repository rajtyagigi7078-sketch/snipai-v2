/** Read actual stage headers, never arbitrary words in paths or filenames. */
export function pipelineStageFromLine(line: string): number | null {
  const message=line.trim();
  if (/^(WHISPER TRANSCRIPTION|Using speech-gated|Detecting speech regions|SWIFT HINGLISH TRANSCRIPTION)/i.test(message)) return 1;
  if (/^(SNIP AI.{0,20}STORY EVENT MAP|STORY EVENT MAP|GENERATION SELECTOR|Hinglish event scoring)/i.test(message)) return 2;
  if (/^(SNIP AI.{0,20}PORTABLE SIMPLE VIDEO RENDERER|PARALLEL RENDERING|\[START\] Clip)/i.test(message)) return 3;
  if (/^(\[RUN\] FFMPEG FRAME\+CAPTION RENDER|Rendering your caption, logo and text changes)/i.test(message)) return 4;
  if (message === 'SNIP_FINALIZING') return 5;
  return null;
}

export type CaptionBatchProgress = { completed: number; total: number; current: number; fraction: number; percent: number; etaSeconds: number | null };
export function captionBatchProgress(line: string): CaptionBatchProgress | null {
  if (!line.startsWith('SNIP_RENDER_PROGRESS:')) return null;
  try {
    const data = JSON.parse(line.slice('SNIP_RENDER_PROGRESS:'.length));
    if (![data.completed,data.total,data.current,data.fraction,data.percent].every(Number.isFinite) || data.total < 1 || data.completed < 0 || data.completed > data.total || data.fraction < 0 || data.fraction > 1 || data.percent < 75 || data.percent > 98) return null;
    return { ...data, etaSeconds: Number.isFinite(data.etaSeconds) && data.etaSeconds >= 0 ? data.etaSeconds : null };
  } catch { return null; }
}

export function generationErrorMessage(error: unknown): string {
  const message=error instanceof Error?error.message:String(error);
  if(message.includes('ASR_NO_SPEECH:') || /speech detector found no clear|No speech regions detected/i.test(message)) return 'No clear spoken voice was detected. Try a video with clear English or Hindi-English dialogue. Songs, music and gameplay without spoken commentary are not supported for automatic clip selection.';
  if(message.includes('ASR_NO_WORDS:') || /no reliable timed words|no reliable words/i.test(message)) return 'Voice was detected, but the words could not be recognized reliably. Check the audio language or try a video with clearer speech.';
  if(message.includes('ASR_NO_MOMENTS:') || /No clip moments were found\./i.test(message)) return 'No usable spoken moments were found for clipping. Choose a video with clear English or Hindi-English conversation. Songs, music and gameplay without spoken commentary are not supported for automatic clip selection.';
  return message.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '').trim();
}
