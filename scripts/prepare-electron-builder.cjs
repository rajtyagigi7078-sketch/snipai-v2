// Preserve the Windows environment when electron-builder runs its uninstaller stub.
// Some builder versions replace it with only __COMPAT_LAYER, causing spawn UNKNOWN.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const runtimeRoot=path.resolve('.build/windows-runtime');
const manifestPath=path.join(runtimeRoot,'native-runtime-manifest.json');
if(!fs.existsSync(manifestPath))throw new Error('Run scripts/prepare-native-runtime.ps1 before packaging.');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8').replace(/^\uFEFF/,''));
for(const file of manifest.files){
  const target=path.join(runtimeRoot,file.path);
  if(!fs.existsSync(target)||crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')!==file.sha256)throw new Error('Bundled runtime hash mismatch: '+file.path);
}
for(const name of ['runtime_check.py','native_runtime.py'])if(!fs.existsSync(path.join(runtimeRoot,'pipeline',name)))throw new Error('Missing runtime verification script: '+name);
const target = require.resolve('app-builder-lib/out/targets/nsis/NsisTarget.js');
const before = fs.readFileSync(target, 'utf8');
const after = before.replace(/await wineVm\.exec\(installerPath, \[\], \{ env: \{ (?:\.\.\.process\.env, )?__COMPAT_LAYER: "RunAsInvoker" \} \}\);/g,
  'await nsisUtil_1.UninstallerReader.exec(installerPath, uninstallerPath);');
if (after !== before) fs.writeFileSync(target, after);
