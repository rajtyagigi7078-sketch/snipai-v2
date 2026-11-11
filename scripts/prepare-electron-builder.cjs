// Preserve the Windows environment when electron-builder runs its uninstaller stub.
// Some builder versions replace it with only __COMPAT_LAYER, causing spawn UNKNOWN.
const fs = require('node:fs');
const path = require('node:path');
const target = require.resolve('app-builder-lib/out/targets/nsis/NsisTarget.js');
const before = fs.readFileSync(target, 'utf8');
const after = before.replace(/await wineVm\.exec\(installerPath, \[\], \{ env: \{ (?:\.\.\.process\.env, )?__COMPAT_LAYER: "RunAsInvoker" \} \}\);/g,
  'await nsisUtil_1.UninstallerReader.exec(installerPath, uninstallerPath);');
if (after !== before) fs.writeFileSync(target, after);
