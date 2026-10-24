const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { collectRuntime } = require('./runtime.cjs');
const root = path.join(__dirname, '..');
let pendingDiagnosis;
ipcMain.handle('diagnose', () => {
  pendingDiagnosis ||= collectRuntime(root).finally(() => { pendingDiagnosis = null; });
  return pendingDiagnosis;
});
ipcMain.handle('save', async (_event, name, bytes) => {
  const ext = path.extname(String(name)).toLowerCase();
  if (!['.glb', '.obj', '.stl'].includes(ext)) throw new Error('Unsupported format');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 512 * 1024 * 1024) throw new Error('Invalid export');
  const result = await dialog.showSaveDialog({ defaultPath: path.basename(name), filters: [{ name: ext.slice(1).toUpperCase(), extensions: [ext.slice(1)] }] });
  if (result.canceled) return false;
  await fs.writeFile(result.filePath, bytes); return true;
});
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1420, height: 1000, minWidth: 900, minHeight: 700, backgroundColor: '#111318', title: 'Hunyuan Studio', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.loadFile(path.join(root, 'dist/index.html'));
});
app.on('window-all-closed', () => app.quit());
