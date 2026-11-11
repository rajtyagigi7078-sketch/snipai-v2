import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("snipaiDesktop", {
  pickVideo: () => ipcRenderer.invoke("snipai:pick-video"),
  pickImage: () => ipcRenderer.invoke("snipai:pick-image"),
  openPath: (target) => ipcRenderer.invoke("snipai:open-path", target),
  runtimeInfo: () => ipcRenderer.invoke("snipai:runtime-info"),
});
