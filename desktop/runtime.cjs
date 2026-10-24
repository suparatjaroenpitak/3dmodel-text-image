const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}
async function exists(file) {
  try { return (await fs.stat(file)).isFile(); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function sizeOf(file) {
  try { return (await fs.stat(file)).size; }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
}
async function incompleteBytes(dir) {
  let total = 0;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  for (const entry of entries) {
    // Do not follow symlinks or enumerate unrelated model/cache directories.
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await incompleteBytes(file);
    else if (entry.isFile() && entry.name.endsWith('.incomplete')) total += await sizeOf(file);
  }
  return total;
}
async function modelStatus(root, repo, name, required) {
  const folder = path.join(root, 'models', ...repo.split('/'));
  const sizes = await Promise.all(required.map(file => sizeOf(path.join(folder, file))));
  const partial = await incompleteBytes(path.join(folder, '.cache', 'huggingface', 'download'));
  return { name, complete: sizes.every(size => size > 0), downloadedMiB: Math.round((sizes.reduce((a, b) => a + b, 0) + partial) / 1024 ** 2) };
}

async function collectRuntime(root, run = exec) {
  const setup = path.join(root, 'outputs', 'setup');
  const diagnosis = await readJson(path.join(setup, 'diagnose.json'));
  let hardware = await readJson(path.join(setup, 'hardware.json'));
  let diagnosticError = null;
  const python = path.join(root, '.venv-ai', 'Scripts', 'python.exe');
  if (await exists(python)) {
    try {
      const { stdout } = await run(python, [path.join(root, 'scripts', 'ai_smoke.py'), 'diagnose'], { windowsHide: true, timeout: 15000, maxBuffer: 256 * 1024, cwd: root, encoding: 'utf8' });
      const current = JSON.parse(stdout);
      if (!current.ok) throw new Error(current.error || 'Hardware diagnostic failed');
      hardware = current;
    } catch (error) { diagnosticError = 'อ่านหน่วยความจำปัจจุบันไม่สำเร็จ'; hardware = null; }
  } else hardware = null;
  const models = await Promise.all([
    modelStatus(root, 'tencent/Hunyuan3D-2mini', 'Hunyuan3D-2mini', ['hunyuan3d-dit-v2-mini/config.yaml', 'hunyuan3d-dit-v2-mini/model.fp16.safetensors']),
    modelStatus(root, 'stabilityai/sd-turbo', 'SD-Turbo', [
      'model_index.json', 'unet/config.json', 'unet/diffusion_pytorch_model.fp16.safetensors',
      'vae/config.json', 'vae/diffusion_pytorch_model.fp16.safetensors',
      'text_encoder/config.json', 'text_encoder/model.fp16.safetensors',
      'scheduler/scheduler_config.json', 'tokenizer/tokenizer_config.json', 'tokenizer/vocab.json', 'tokenizer/merges.txt',
    ]),
  ]);
  let exit = null;
  try { exit = (await fs.readFile(path.join(setup, 'download.exit'), 'utf8')).trim(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const downloadReport = await readJson(path.join(setup, 'download.json'));
  let downloadState = models.every(model => model.complete) ? 'ไฟล์โมเดลครบ · ยังต้องทดสอบ inference' : 'ไฟล์โมเดลยังไม่ครบ';
  if (exit !== null && exit !== '0') downloadState = 'ดาวน์โหลดจบด้วยข้อผิดพลาด · ตรวจ log';
  else if (exit === null && models.some(model => model.downloadedMiB > 0)) downloadState = 'มีไฟล์ดาวน์โหลดบางส่วน · ยังไม่มีผลจบงาน';
  const reports = await Promise.all(['image-result.json', 'text-result.json', 'text-shape-result.json'].map(file => readJson(path.join(root, 'outputs', 'smoke', file))));
  return {
    checkedAt: new Date().toISOString(),
    gpu: hardware?.gpu || 'ตรวจ GPU ปัจจุบันไม่ได้',
    hardware: hardware ? { ram_free_gib: hardware.ram_free_gib, vram_free_mib: hardware.vram_free_mib } : null,
    environmentReady: Boolean(diagnosis?.ok && diagnosis?.imports_ok && diagnosis?.cuda_available),
    environmentCheckedAt: diagnosis?.ok ? diagnosis.checkedAt || null : null,
    models, downloadState,
    inferenceVerified: reports.every(report => report?.ok === true) && reports[0]?.validation?.faces > 0 && reports[2]?.validation?.faces > 0,
    ready: false, generationAvailable: false,
    message: 'หน้าจอยังไม่ได้เชื่อมระบบสร้าง AI จริง',
    error: diagnosticError || (exit !== null && exit !== '0' ? downloadReport?.error || 'ตรวจ outputs/setup/download.log' : null),
  };
}
module.exports = { collectRuntime };
