const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studio', {
  diagnose: () => ipcRenderer.invoke('diagnose'),
  save: (name, bytes) => ipcRenderer.invoke('save', name, bytes),
});
