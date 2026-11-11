'use strict';

// Read-only migration from Snip AI's former Tauri WebView2 storage. Nothing
// returned here grants activation: the caller must verify the candidate's
// installation ID with the license service before writing a new receipt.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const STATE_KEY = 'snip-ai.store-license.v1';
const DEVICE_KEY = 'snip-ai.install-id.v1';
const MAX_FILE_SIZE = 32 * 1024 * 1024;

function varint(bytes, start) {
  let value = 0, multiplier = 1, offset = start;
  for (let count = 0; count < 10 && offset < bytes.length; count++) {
    const byte = bytes[offset++]; value += (byte & 127) * multiplier;
    if (!(byte & 128)) return { value, offset };
    multiplier *= 128;
  }
  throw new Error('Invalid LevelDB varint');
}

function snappy(bytes) {
  const header = varint(bytes, 0);
  if (header.value > MAX_FILE_SIZE) throw new Error('Storage block exceeds limit');
  const output = Buffer.alloc(header.value); let input = header.offset, target = 0;
  while (input < bytes.length && target < output.length) {
    const tag = bytes[input++], kind = tag & 3; let length, offset;
    if (kind === 0) {
      length = tag >>> 2;
      if (length < 60) length++;
      else {
        const size = length - 59; length = 0;
        if (size > 4 || input + size > bytes.length) throw new Error('Invalid literal');
        for (let i = 0; i < size; i++) length += bytes[input++] * 2 ** (8 * i);
        length++;
      }
      if (input + length > bytes.length || target + length > output.length) throw new Error('Invalid literal length');
      bytes.copy(output, target, input, input + length); input += length; target += length;
    } else {
      if (kind === 1) { length = 4 + ((tag >>> 2) & 7); offset = ((tag & 224) << 3) | bytes[input++]; }
      else if (kind === 2) { length = 1 + (tag >>> 2); if (input + 2 > bytes.length) throw new Error('Invalid copy'); offset = bytes.readUInt16LE(input); input += 2; }
      else { length = 1 + (tag >>> 2); if (input + 4 > bytes.length) throw new Error('Invalid copy'); offset = bytes.readUInt32LE(input); input += 4; }
      if (!offset || offset > target || target + length > output.length) throw new Error('Invalid copy offset');
      for (let i = 0; i < length; i++) { output[target] = output[target - offset]; target++; }
    }
  }
  if (target !== output.length) throw new Error('Incomplete storage block');
  return output;
}

function recordsFromBlock(block) {
  if (block.length < 4) throw new Error('Short block');
  const restarts = block.readUInt32LE(block.length - 4), end = block.length - 4 - restarts * 4;
  if (end < 0) throw new Error('Invalid restarts');
  const entries = []; let cursor = 0, previous = Buffer.alloc(0);
  while (cursor < end) {
    const shared = varint(block, cursor), unshared = varint(block, shared.offset), size = varint(block, unshared.offset);
    cursor = size.offset;
    if (shared.value > previous.length || cursor + unshared.value + size.value > end) throw new Error('Invalid entry');
    const key = Buffer.concat([previous.subarray(0, shared.value), block.subarray(cursor, cursor + unshared.value)]);
    cursor += unshared.value; const value = block.subarray(cursor, cursor + size.value); cursor += size.value;
    entries.push({ key, value }); previous = key;
  }
  return entries;
}

function tableBlock(file, handle) {
  const offset = varint(handle, 0), size = varint(handle, offset.offset);
  if (offset.value + size.value + 5 > file.length) throw new Error('Invalid table block');
  const bytes = file.subarray(offset.value, offset.value + size.value), compression = file[offset.value + size.value];
  if (compression === 0) return bytes;
  if (compression === 1) return snappy(bytes);
  throw new Error('Unsupported table compression');
}

function stringFromStorage(bytes) {
  if (!bytes.length) return '';
  if (bytes[0] === 0) return bytes.subarray(1).toString('utf16le');
  if (bytes[0] === 1) return bytes.subarray(1).toString('latin1');
  return bytes.toString('utf8');
}

function knownKey(key) {
  if (key[0] !== 95) return null;
  const boundary = key.indexOf(0); if (boundary < 0) return null;
  const origin = key.subarray(1, boundary).toString('utf8');
  if (!['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost'].includes(origin)) return null;
  const name = stringFromStorage(key.subarray(boundary + 1));
  return [STATE_KEY, DEVICE_KEY].includes(name) ? { origin, name } : null;
}

function takeRecord(map, key, value, sequence, deleted) {
  const match = knownKey(key); if (!match) return;
  const index = `${match.origin}\u0000${match.name}`, old = map.get(index);
  if (!old || sequence > old.sequence) map.set(index, { ...match, sequence, value: deleted ? null : stringFromStorage(value) });
}

function parseTable(bytes, records) {
  if (bytes.length < 48 || bytes.readBigUInt64LE(bytes.length - 8) !== 0xdb4775248b80fb57n) throw new Error('Invalid table');
  const footer = bytes.subarray(bytes.length - 48, bytes.length - 8), metaOffset = varint(footer, 0), metaSize = varint(footer, metaOffset.offset);
  const indexOffset = varint(footer, metaSize.offset), indexSize = varint(footer, indexOffset.offset);
  const indexHandle = footer.subarray(metaSize.offset, indexSize.offset);
  for (const item of recordsFromBlock(tableBlock(bytes, indexHandle))) {
    for (const entry of recordsFromBlock(tableBlock(bytes, item.value))) {
      if (entry.key.length < 8) continue;
      const trailer = entry.key.readBigUInt64LE(entry.key.length - 8);
      takeRecord(records, entry.key.subarray(0, -8), entry.value, trailer >> 8n, (trailer & 255n) === 0n);
    }
  }
}

function parseBatch(batch, records) {
  if (batch.length < 12) return;
  const sequence = batch.readBigUInt64LE(0), count = batch.readUInt32LE(8); let cursor = 12;
  if (count > 100000) throw new Error('Oversized batch');
  for (let i = 0; i < count && cursor < batch.length; i++) {
    const kind = batch[cursor++], keySize = varint(batch, cursor); cursor = keySize.offset;
    if (cursor + keySize.value > batch.length) throw new Error('Invalid batch key');
    const key = batch.subarray(cursor, cursor + keySize.value); cursor += keySize.value;
    let value = Buffer.alloc(0);
    if (kind === 1) { const valueSize = varint(batch, cursor); cursor = valueSize.offset; if (cursor + valueSize.value > batch.length) throw new Error('Invalid batch value'); value = batch.subarray(cursor, cursor + valueSize.value); cursor += valueSize.value; }
    else if (kind !== 0) throw new Error('Invalid batch record');
    takeRecord(records, key, value, sequence + BigInt(i), kind === 0);
  }
}

function parseLog(bytes, records) {
  let cursor = 0, fragments = [];
  while (cursor + 7 <= bytes.length) {
    const remaining = 32768 - cursor % 32768;
    if (remaining < 7) { cursor += remaining; continue; }
    const length = bytes.readUInt16LE(cursor + 4), type = bytes[cursor + 6];
    if (!length && !type) { cursor += remaining; continue; }
    if (length + 7 > remaining || cursor + length + 7 > bytes.length) break;
    const payload = bytes.subarray(cursor + 7, cursor + 7 + length); cursor += 7 + length;
    if (type === 1) { fragments = []; parseBatch(payload, records); }
    else if (type === 2) fragments = [payload];
    else if (type === 3 && fragments.length) fragments.push(payload);
    else if (type === 4 && fragments.length) { fragments.push(payload); parseBatch(Buffer.concat(fragments), records); fragments = []; }
  }
}

function profileCandidates() {
  const home = os.homedir(), local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const bases = [path.join(local, 'com.clipper.app'), path.join(home, 'AppData', 'Local', 'com.clipper.app'), path.join(home, 'AppData', 'Local', 'Packages', 'OpenAI.Codex_2p2nqsd0c76g0', 'LocalCache', 'Local', 'com.clipper.app')];
  return [...new Set(bases.map(base => path.join(base, 'EBWebView', 'Default', 'Local Storage', 'leveldb')))];
}

async function readLegacyLicenseCandidate({ profiles = profileCandidates() } = {}) {
  for (const profilePath of profiles) {
    const records = new Map();
    let files; try { files = await fs.readdir(profilePath, { withFileTypes: true }); } catch { continue; }
    for (const entry of files) {
      if (!entry.isFile() || !/^\d+\.(log|ldb|sst)$/.test(entry.name)) continue;
      try {
        const filename = path.join(profilePath, entry.name), info = await fs.stat(filename);
        if (info.size > MAX_FILE_SIZE) continue;
        const bytes = await fs.readFile(filename);
        if (entry.name.endsWith('.log')) parseLog(bytes, records); else parseTable(bytes, records);
      } catch { /* A locked/incomplete file is ignored; never mutate old storage. */ }
    }
    for (const origin of ['https://tauri.localhost', 'http://tauri.localhost', 'tauri://localhost']) {
      const stateValue = records.get(`${origin}\u0000${STATE_KEY}`)?.value, deviceId = records.get(`${origin}\u0000${DEVICE_KEY}`)?.value;
      if (!stateValue || !deviceId || !/^[a-f0-9-]{32,64}$/i.test(deviceId)) continue;
      try {
        const state = JSON.parse(stateValue);
        if (state.active !== true || state.productSlug !== 'snip-ai' || !/^[A-Z0-9]{4,5}$/.test(state.keyLast4 || '') || !Number.isFinite(Date.parse(state.activatedAt))) continue;
        return { deviceId, keyLast4: state.keyLast4, activatedAt: state.activatedAt, productSlug: 'snip-ai', source: 'tauri-webview2', profilePath, origin, requiresServerVerification: true };
      } catch { /* Invalid local state never grants activation. */ }
    }
  }
  return null;
}

module.exports = { readLegacyLicenseCandidate, profileCandidates };
