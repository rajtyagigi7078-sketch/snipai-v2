const { readFile, writeFile, rename, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');

const releaseUrl = 'https://lhwvxzumettopbydrysl.supabase.co/functions/v1/store-release-license';

function createUninstallLicense(profile, encryption, request = fetch) {
  const credential = join(profile, 'uninstall-license.bin');
  const marker = join(profile, 'license-released');

  async function save({key, deviceId, publishableKey}) {
    if (!encryption.isEncryptionAvailable()) throw new Error('Windows credential protection is unavailable.');
    if (!/^SNIP-AI-[A-Z0-9-]{8,80}$/.test(key) || !/^[a-f0-9-]{32,64}$/i.test(deviceId) ||
        !/^(sb_publishable_[\w-]+|eyJ[\w.-]+)$/.test(publishableKey)) throw new Error('Invalid uninstall credential.');
    const temp = credential + '.' + randomUUID();
    try {
      await writeFile(temp, encryption.encryptString(JSON.stringify({key, deviceId, publishableKey})));
      await rename(temp, credential);
      await rm(marker, {force:true});
    } finally {
      await rm(temp, {force:true});
    }
  }

  async function clear() {
    await writeFile(marker, '');
    await rm(credential, {force:true});
  }

  async function release() {
    const encrypted = await readFile(credential).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!encrypted) return;
    const {key, deviceId, publishableKey} = JSON.parse(encryption.decryptString(encrypted));
    const response = await request(releaseUrl, {
      method: 'POST',
      headers: { apikey: publishableKey, 'Content-Type': 'application/json', ...(publishableKey.startsWith('eyJ') ? {Authorization: 'Bearer '+publishableKey} : {}) },
      body: JSON.stringify({product_slug:'snip-ai', license_key:key, device_id:deviceId}),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok || data?.released !== true) throw new Error('Device release failed.');
    await clear();
  }

  return {save, clear, release, marker};
}

module.exports = {createUninstallLicense};
