module.exports = {
  appId: 'com.snipai.desktop',
  productName: 'Snip AI',
  directories: { output: 'release-mac' },
  electronDist: null,
  npmRebuild: false,
  files: ['dist/**/*', 'electron/**/*', 'package.json', '!node_modules/**/*'],
  asarUnpack: ['dist/assets/capsnip-typography/**/*'],
  extraResources: [{ from: '.build/macos-runtime', to: 'macos-runtime', filter: ['**/*', '!**/__pycache__/**', '!**/*.pyc'] }],
  mac: {
    icon: 'src-tauri/icons/icon.icns',
    category: 'public.app-category.video',
    target: ['dmg', 'zip'],
    identity: null,
    artifactName: 'Snip-AI-${version}-mac-${arch}.${ext}',
    extendInfo: { NSHighResolutionCapable: true }
  },
  dmg: { title: 'Snip AI', contents: [{ x: 130, y: 220 }, { x: 410, y: 220, type: 'link', path: '/Applications' }] }
};
