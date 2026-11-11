const { contextBridge, ipcRenderer, webUtils } = require('electron');

const events = new Set(['pipeline-progress','youtube-download-progress','youtube-download-preview']);
contextBridge.exposeInMainWorld('snipaiDesktop', {
  filePath: (file) => webUtils.getPathForFile(file),
  reportUiReady: (screen) => ipcRenderer.send('snipai:ui-ready', String(screen)),
  invoke: (command, args = {}) => ipcRenderer.invoke('snipai:invoke', command, args),
  on: (event, callback) => {
    if (!events.has(event)) throw new Error('Unsupported event');
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
  openDialog: (options) => ipcRenderer.invoke('snipai:dialog', options),
  pickVideo: () => ipcRenderer.invoke('snipai:dialog', { filters: [{name:'Video', extensions:['mp4','mov','mkv','webm','avi']}] }),
  pickImage: () => ipcRenderer.invoke('snipai:dialog', { filters: [{name:'Image', extensions:['png','jpg','jpeg','webp']}] }),
  openPath: (target) => ipcRenderer.invoke('snipai:open-path', target),
  openUrl: (target) => ipcRenderer.invoke('snipai:open-url', target),
  mediaUrl: (target) => 'snip-media://local/file?path=' + encodeURIComponent(target),
  runtimeInfo: () => ipcRenderer.invoke('snipai:runtime-info'),
});
