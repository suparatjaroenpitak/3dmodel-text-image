const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const root = path.join(__dirname, '..');
const output = path.join(root, 'outputs', 'ui');
const errors = [];
let destination;
// Only the OS save picker is automated: production renderer, preload, IPC and disk writes are real.
dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
require('../desktop/main.cjs');
const timer = setTimeout(() => { console.error('Electron smoke timed out'); app.exit(1); }, 90000);

async function main() {
  await fs.mkdir(output, { recursive: true });
  await app.whenReady();
  const win = BrowserWindow.getAllWindows()[0];
  assert.ok(win, 'Production BrowserWindow exists');
  win.webContents.on('console-message', (_event, ...args) => {
    const message = typeof args[0] === 'object' ? args[0] : { level: args[0], message: args[1] };
    if (message.level === 'error' || message.level === 3) errors.push(message.message);
  });
  const js = expression => win.webContents.executeJavaScript(expression, true);
  for (let i = 0; i < 100; i++) {
    if (await js('Boolean(document.querySelector("#vertex-count")?.textContent !== "—" && document.querySelector("canvas"))').catch(() => false)) break;
    await delay(200);
  }
  assert.equal(await js('typeof window.studio?.diagnose'), 'function');
  assert.equal(await js('typeof require'), 'undefined');
  assert.equal(await js('document.querySelector("#generate").disabled'), true);
  assert.equal(await js('document.querySelector("#viewer-unavailable").hidden'), true);
  const live = await js('window.studio.diagnose()');
  assert.equal(live.generationAvailable, live.models.every(model => model.complete));
  assert.equal(live.inferenceVerified, false);
  assert.equal(live.ready, false);
  assert.ok(live.models.length === 2);
  await js('document.querySelector("[data-example=fox]").click()');
  assert.match(await js('document.querySelector("#prompt").value'), /orange ceramic fox/);
  await js('document.querySelector("#image-tab").click()');
  assert.equal(await js('document.querySelector("#text-panel").hidden'), true);
  await js(`(() => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'orange'; ctx.fillRect(8,8,16,16);
    return new Promise(resolve => canvas.toBlob(blob => {
      const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'test-cutout.png', {type:'image/png'}));
      const input = document.querySelector('#image-input'); input.files = transfer.files; input.dispatchEvent(new Event('change')); resolve();
    }));
  })()`);
  for (let i = 0; i < 50 && await js('document.querySelector("#image-preview").hidden'); i++) await delay(100);
  assert.equal(await js('document.querySelector("#image-name").textContent'), 'test-cutout.png');
  await js('document.querySelector("#remove-image").click()');
  assert.equal(await js('document.querySelector("#image-preview").hidden'), true);
  await js('document.querySelector("#text-tab").click(); document.querySelector("#wireframe").click(); document.querySelector("#clay-mode").click();');
  assert.equal(await js('document.querySelector("#wireframe").getAttribute("aria-pressed")'), 'true');
  await js('document.querySelector("#wireframe").click(); document.querySelector("#clay-mode").click();');
  await fs.writeFile(path.join(output, 'desktop.png'), (await win.webContents.capturePage()).toPNG());

  async function exportFile(format, label) {
    destination = path.join(output, `${label}.${format}`);
    await js(`document.querySelector('#export-format').value = ${JSON.stringify(format)}; document.querySelector('#export-model').click()`);
    for (let i = 0; i < 100; i++) {
      try { if ((await fs.stat(destination)).size > 0) break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await delay(100);
    }
    const bytes = await fs.readFile(destination);
    assert.ok(bytes.length > 80, 'actual IPC export wrote a nonempty file');
    if (format === 'glb') { assert.equal(bytes.toString('ascii', 0, 4), 'glTF'); assert.equal(bytes.readUInt32LE(8), bytes.length); }
    if (format === 'obj') assert.match(bytes.toString(), /\nv /);
    return bytes;
  }
  async function importFile(bytes, name) {
    await js(`(() => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), c => c.charCodeAt(0));
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], ${JSON.stringify(name)}));
      const input = document.querySelector('#model-input'); input.files = transfer.files; input.dispatchEvent(new Event('change'));
    })()`);
    for (let i = 0; i < 100 && await js('document.querySelector("#import-model").disabled'); i++) await delay(100);
    assert.equal(await js('document.querySelector("#model-name").textContent'), name);
    assert.match(await js('document.querySelector("#source-badge").textContent'), /ไฟล์ที่นำเข้า/);
  }
  for (const format of ['glb', 'obj', 'stl']) {
    const bytes = await exportFile(format, `sample-roundtrip-${format}`);
    await importFile(bytes, `roundtrip.${format}`);
  }
  const previous = await js('document.querySelector("#model-name").textContent');
  await js(`(() => { const transfer = new DataTransfer(); transfer.items.add(new File(['broken'], 'corrupt.glb')); const input=document.querySelector('#model-input'); input.files=transfer.files; input.dispatchEvent(new Event('change')); })()`);
  await delay(200);
  assert.equal(await js('document.querySelector("#model-name").textContent'), previous);
  assert.match(await js('document.querySelector("#toast").textContent'), /ไม่สำเร็จ/);
  await js('document.querySelector("#load-sample").click(); document.querySelector("#open-system").click()');
  await delay(2000);
  assert.equal(await js('document.querySelector("#system-dialog").open'), true);
  assert.match(await js('document.querySelector("#system-content").textContent'), /Hunyuan3D-2mini/);
  await fs.writeFile(path.join(output, 'desktop-system.png'), (await win.webContents.capturePage()).toPNG());
  assert.deepEqual(errors, [], 'no renderer console errors');
  await fs.writeFile(path.join(output, 'electron-result.json'), JSON.stringify({
    ok: true, tests: ['production renderer/preload', 'CUDA/model diagnostics IPC', 'text example', 'image upload/removal', 'viewer toggles', 'GLB/OBJ/STL export and import roundtrips', 'corrupt input preserves model', 'system dialog'],
    generationAvailable: live.generationAvailable, models: live.models, gpu: live.gpu,
  }, null, 2));
  console.log('Electron smoke passed: renderer, upload, live diagnostics, 3 format roundtrips, invalid import, screenshots.');
}
main().then(() => { clearTimeout(timer); app.exit(0); }).catch(error => { clearTimeout(timer); console.error(error); app.exit(1); });
