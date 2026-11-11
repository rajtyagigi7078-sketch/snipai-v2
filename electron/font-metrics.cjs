const fs=require('node:fs');
const path=require('node:path');
const fontMetricCache = new Map();

function readFontMetrics(fontFile) {
  if (!fontFile) return null;
  const key = path.resolve(fontFile);
  if (fontMetricCache.has(key)) return fontMetricCache.get(key);
  try {
    const data = fs.readFileSync(key);
    const u16 = (at) => data.readUInt16BE(at);
    const u32 = (at) => data.readUInt32BE(at);
    const tables = new Map();
    const count = u16(4);
    for (let i = 0; i < count; i += 1) {
      const entry = 12 + i * 16;
      tables.set(data.toString('ascii', entry, entry + 4), { offset: u32(entry + 8), length: u32(entry + 12) });
    }
    const head = tables.get('head');
    const hhea = tables.get('hhea');
    const maxp = tables.get('maxp');
    const cmap = tables.get('cmap');
    const hmtx = tables.get('hmtx');
    if (!head || !hhea || !maxp || !cmap || !hmtx) throw new Error('Required TrueType tables are missing');
    const unitsPerEm = u16(head.offset + 18);
    const metricCount = u16(hhea.offset + 34);
    const glyphCount = u16(maxp.offset + 4);
    const advances = new Uint16Array(glyphCount);
    let lastAdvance = 0;
    for (let i = 0; i < glyphCount; i += 1) {
      if (i < metricCount) lastAdvance = u16(hmtx.offset + i * 4);
      advances[i] = lastAdvance;
    }
    let format4 = null;
    let format12 = null;
    const cmapCount = u16(cmap.offset + 2);
    for (let i = 0; i < cmapCount; i += 1) {
      const record = cmap.offset + 4 + i * 8;
      const sub = cmap.offset + u32(record + 4);
      const format = u16(sub);
      if (format === 12) format12 = { offset: sub, groups: u32(sub + 12) };
      if (format === 4) format4 = { offset: sub, segments: u16(sub + 6) / 2 };
    }
    const glyphFor = (code) => {
      if (code > 0xFFFF && format12) {
        let lo = 0, hi = format12.groups - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const group = format12.offset + 16 + mid * 12;
          const start = u32(group), end = u32(group + 4);
          if (code < start) hi = mid - 1;
          else if (code > end) lo = mid + 1;
          else return u32(group + 8) + code - start;
        }
      }
      if (!format4 || code > 0xFFFF) return 0;
      const base = format4.offset;
      const endBase = base + 14;
      const startBase = endBase + format4.segments * 2 + 2;
      const deltaBase = startBase + format4.segments * 2;
      const rangeBase = deltaBase + format4.segments * 2;
      for (let i = 0; i < format4.segments; i += 1) {
        const end = u16(endBase + i * 2);
        const start = u16(startBase + i * 2);
        if (code < start || code > end) continue;
        const delta = data.readInt16BE(deltaBase + i * 2);
        const range = u16(rangeBase + i * 2);
        if (!range) return (code + delta) & 0xFFFF;
        const glyphAt = rangeBase + i * 2 + range + (code - start) * 2;
        const glyph = u16(glyphAt);
        return glyph ? (glyph + delta) & 0xFFFF : 0;
      }
      return 0;
    };
    const metrics = { unitsPerEm, advances, glyphFor };
    fontMetricCache.set(key, metrics);
    return metrics;
  } catch (_) {
    fontMetricCache.set(key, null);
    return null;
  }
}

function measureText(text, size, ctx, fontFile) {
  if (ctx && typeof ctx.measureText === 'function') return ctx.measureText(text).width;
  const metrics = readFontMetrics(fontFile);
  if (metrics) {
    let advance = 0;
    for (const character of text) advance += metrics.advances[metrics.glyphFor(character.codePointAt(0))] || 0;
    return advance * size / metrics.unitsPerEm;
  }
  // Last-resort estimate for environments where no canvas or TrueType font is available.
  let units = 0;
  for (const ch of text) {
    if ("ilI.,'!:;|".includes(ch)) units += 0.30;
    else if ('mwMW@%&'.includes(ch)) units += 0.88;
    else if ('ABCDEFGHKNOPQRSTUVXYZ'.includes(ch)) units += 0.68;
    else if (ch === ' ') units += 0.32;
    else units += 0.56;
  }
  return units * size;
}

module.exports={measureText};
