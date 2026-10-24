const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const root = path.join(__dirname, '..');
ipcMain.handle('diagnose', () => new Promise(resolve => {
  execFile('nvidia-smi', ['--query-gpu=name,memory.total,memory.free', '--format=csv,noheader'], { windowsHide: true, timeout: 10000 }, (error, stdout) => resolve({ gpu: error ? 'ตรวจ GPU ไม่สำเร็จ' : stdout.trim(), ready: false, message: 'ยังไม่ได้ยืนยันชุดโมเดลและระบบสร้างพื้นผิวบนเครื่องนี้' }));
}));
ipcMain.handle('save', async (_event, name, bytes) => {
  const ext = path.extname(String(name)).toLowerCase();
  if (!['.glb', '.obj', '.stl'].includes(ext)) throw new Error('Unsupported format');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 512 * 1024 * 1024) throw new Error('Invalid export');
  const result = await dialog.showSaveDialog({ defaultPath: path.basename(name), filters: [{ name: ext.slice(1).toUpperCase(), extensions: [ext.slice(1)] }] });
  if (result.canceled) return false;
  await fs.writeFile(result.filePath, bytes); return true;
});
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1420, height: 920, minWidth: 1000, minHeight: 700, backgroundColor: '#101214', title: 'Hunyuan Studio', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.loadFile(path.join(root, 'dist/index.html'));
});
app.on('window-all-closed', () => app.quit());
