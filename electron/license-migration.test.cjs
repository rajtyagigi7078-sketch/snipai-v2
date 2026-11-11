const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { readLegacyLicenseCandidate } = require('./license-migration.cjs');

const stateName = 'snip-ai.store-license.v1', deviceName = 'snip-ai.install-id.v1';
const device = '11111111-2222-4333-8444-555555555555';
const state = JSON.stringify({ active: true, productSlug: 'snip-ai', keyLast4: 'ABCD', activatedAt: '2026-01-01T00:00:00Z' });
function vint(value) { const bytes = []; do { let n = value & 127; value = Math.floor(value / 128); if (value) n |= 128; bytes.push(n); } while (value); return Buffer.from(bytes); }
function encode(name, value, origin = 'http://tauri.localhost') {
  const key = Buffer.concat([Buffer.from(`_${origin}\0`), Buffer.from([1]), Buffer.from(name)]);
  const bytes = value === null ? null : Buffer.concat([Buffer.from([1]), Buffer.from(value)]);
  return Buffer.concat([Buffer.from([bytes === null ? 0 : 1]), vint(key.length), key, ...(bytes === null ? [] : [vint(bytes.length), bytes])]);
}
function batch(records, sequence = 1n) { const header = Buffer.alloc(12); header.writeBigUInt64LE(sequence); header.writeUInt32LE(records.length, 8); const payload = Buffer.concat([header, ...records]), prefix = Buffer.alloc(7); prefix.writeUInt16LE(payload.length, 4); prefix[6] = 1; return Buffer.concat([prefix, payload]); }
async function fixture(t, bytes) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snipai-license-migration-test-'));
  t.after(async () => { if (path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(dir).startsWith('snipai-license-migration-test-')) await fs.rm(dir, { recursive: true, force: true }); });
  await fs.writeFile(path.join(dir, '000001.log'), bytes); return dir;
}
test('extracts only a paired known license/device record as a verification candidate', async t => {
  const dir = await fixture(t, batch([encode(stateName, state), encode(deviceName, device)]));
  const candidate = await readLegacyLicenseCandidate({ profiles: [dir] });
  assert.equal(candidate.deviceId, device); assert.equal(candidate.keyLast4, 'ABCD'); assert.equal(candidate.requiresServerVerification, true); assert.equal(candidate.active, undefined);
});
test('never combines records from different origins', async t => {
  const dir = await fixture(t, batch([encode(stateName, state), encode(deviceName, device, 'https://tauri.localhost')]));
  assert.equal(await readLegacyLicenseCandidate({ profiles: [dir] }), null);
});
test('respects a later deleted activation record', async t => {
  const dir = await fixture(t, Buffer.concat([batch([encode(stateName, state), encode(deviceName, device)]), batch([encode(stateName, null)], 10n)]));
  assert.equal(await readLegacyLicenseCandidate({ profiles: [dir] }), null);
});
test('ignores records from unrelated websites', async t => {
  const dir = await fixture(t, batch([encode(stateName, state, 'https://example.com'), encode(deviceName, device, 'https://example.com')]));
  assert.equal(await readLegacyLicenseCandidate({ profiles: [dir] }), null);
});
test('rejects another app or malformed installation id', async t => {
  const dir = await fixture(t, batch([encode(stateName, state.replace('snip-ai', 'capsnip')), encode(deviceName, 'invalid')]));
  assert.equal(await readLegacyLicenseCandidate({ profiles: [dir] }), null);
});
