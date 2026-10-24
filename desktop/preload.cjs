const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studio', {
  diagnose: () => ipcRenderer.invoke('diagnose'),
  generate: request => ipcRenderer.invoke('generate', request),
  cancelGenerate: () => ipcRenderer.invoke('cancel-generate'),
  onGenerateProgress: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('generate-progress', listener);
    return () => ipcRenderer.removeListener('generate-progress', listener);
  },
  save: (name, bytes) => ipcRenderer.invoke('save', name, bytes),
});
