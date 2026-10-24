const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_GLB_BYTES = 80 * 1024 * 1024;
const STAGE_TIMEOUT_MS = 20 * 60 * 1000;
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp']);

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  throw new Error('ข้อมูลรูปไม่ถูกต้อง');
}

function extensionOf(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (!IMAGE_EXT.has(ext)) throw new Error('รองรับรูป PNG, JPG และ WebP เท่านั้น');
  return ext === 'jpeg' ? 'jpg' : ext;
}

function validateRequest(request) {
  if (!request || typeof request !== 'object') throw new Error('คำสั่งสร้างไม่ถูกต้อง');
  if (request.mode !== 'text' && request.mode !== 'image') throw new Error('เลือกข้อความหรือรูปภาพ');
  if (request.mode === 'text') {
    if (typeof request.prompt !== 'string') throw new Error('ต้องมีข้อความ');
    const prompt = request.prompt.trim();
    if (!prompt || prompt.length > 1000 || prompt.includes('\0')) throw new Error('ข้อความต้องมี 1–1,000 ตัวอักษร');
    return { mode: 'text', prompt };
  }
  if (request.whiteBackground !== undefined && typeof request.whiteBackground !== 'boolean') {
    throw new Error('ตัวเลือกพื้นหลังไม่ถูกต้อง');
  }
  const bytes = asBuffer(request.imageBytes);
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('รูปต้องมีขนาดไม่เกิน 20 MB และไม่ว่าง');
  return { mode: 'image', ext: extensionOf(request.imageName), bytes, whiteBackground: request.whiteBackground === true };
}

function inside(dir, file) {
  const base = path.resolve(dir);
  const target = path.resolve(file);
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('เส้นทางงานไม่ถูกต้อง');
  return target;
}

function readReportSync(text) {
  const trimmed = String(text || '').trim();
  const start = trimmed.lastIndexOf('\n{');
  const chunk = start >= 0 ? trimmed.slice(start + 1) : trimmed;
  try { return JSON.parse(chunk); }
  catch { return null; }
}

function createGeneration(options) {
  const root = options.root;
  const spawnImpl = options.spawnImpl || spawn;
  const python = options.python || path.join(root, '.venv-ai', 'Scripts', 'python.exe');
  const script = path.join(root, 'scripts', 'ai_smoke.py');
  const timeoutMs = options.timeoutMs || STAGE_TIMEOUT_MS;
  let active = null;

  function killTree(child) {
    if (!child || child.killed) return;
    if (options.killImpl) {
      options.killImpl(child);
      return;
    }
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    }
    try { child.kill(); } catch { /* already gone */ }
  }

  function runStage(ac, args, reportPath) {
    return new Promise((resolve, reject) => {
      const child = spawnImpl(python, [script, '--report', reportPath, ...args], {
        cwd: root,
        windowsHide: true,
        shell: false,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      ac.child = child;
      let stdout = '';
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      const timer = setTimeout(() => {
        killTree(child);
        fail(new Error('หมดเวลารอการสร้าง'));
      }, timeoutMs);
      child.stdout?.on('data', chunk => { stdout = (stdout + chunk).slice(-100000); });
      child.stderr?.on('data', () => {});
      child.on('error', () => fail(new Error('เริ่มสคริปต์ไม่สำเร็จ')));
      child.on('close', async () => {
        if (settled) return;
        if (ac.cancelled) return fail(new Error('ยกเลิกการสร้างแล้ว'));
        try {
          let report = null;
          try { report = JSON.parse(await fs.readFile(reportPath, 'utf8')); }
          catch { report = readReportSync(stdout); }
          if (!report?.ok) fail(new Error(report?.error || 'สคริปต์สร้างโมเดลไม่สำเร็จ'));
          else {
            settled = true;
            clearTimeout(timer);
            resolve(report);
          }
        } catch (error) {
          fail(error instanceof Error ? error : new Error('สคริปต์สร้างโมเดลไม่สำเร็จ'));
        }
      });
    });
  }

  async function start(request, onProgress = () => {}) {
    if (active) throw new Error('มีการสร้างอยู่แล้ว');
    const job = validateRequest(request);
    const ac = { cancelled: false, child: null };
    active = ac;
    try {
      try { await fs.access(python); }
      catch { throw new Error('ไม่พบ Python ของโปรเจกต์'); }
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      if (!/^[a-z0-9-]+$/.test(id)) throw new Error('สร้างงานไม่สำเร็จ');
      const dir = path.join(root, 'outputs', 'jobs', id);
      await fs.mkdir(dir, { recursive: true });
      let imagePath;
      let preview = null;
      if (job.mode === 'text') {
        if (ac.cancelled) throw new Error('ยกเลิกการสร้างแล้ว');
        onProgress({ stage: 'text', message: 'กำลังสร้างภาพจากข้อความ' });
        imagePath = inside(dir, path.join(dir, 'text.png'));
        await runStage(ac, ['text', '--prompt', job.prompt, '--output', imagePath, '--seed', '12345'], inside(dir, path.join(dir, 'text.json')));
        preview = await fs.readFile(imagePath);
      } else {
        imagePath = inside(dir, path.join(dir, `input.${job.ext}`));
        await fs.writeFile(imagePath, job.bytes);
      }
      if (ac.cancelled) throw new Error('ยกเลิกการสร้างแล้ว');
      const whiteBackground = job.mode === 'text' || job.whiteBackground;
      onProgress({
        stage: 'shape',
        message: whiteBackground ? 'กำลังสร้างรูปทรง 3D · ตัดพื้นขาวแบบทดสอบ' : 'กำลังสร้างรูปทรง 3D',
      });
      const glbPath = inside(dir, path.join(dir, 'shape.glb'));
      const shapeArgs = ['shape', '--image', imagePath, '--output', glbPath, '--steps', '8', '--resolution', '128', '--chunks', '1024', '--seed', '12345'];
      if (whiteBackground) shapeArgs.push('--white-background');
      const shapeReport = await runStage(ac, shapeArgs, inside(dir, path.join(dir, 'shape.json')));
      const glb = await fs.readFile(glbPath);
      if (glb.length < 20 || glb.length > MAX_GLB_BYTES || glb.toString('ascii', 0, 4) !== 'glTF' || glb.readUInt32LE(4) !== 2 || glb.readUInt32LE(8) !== glb.length) {
        throw new Error('ไฟล์ GLB ที่ได้ไม่ถูกต้อง');
      }
      onProgress({ stage: 'done', message: 'สร้างรูปทรงแล้ว' });
      return {
        jobId: id,
        name: 'hunyuan-shape.glb',
        glb,
        preview,
        validation: shapeReport.validation || null,
        maskMethod: shapeReport.mask_method || null,
        quality: shapeReport.quality || null,
      };
    } finally {
      if (active === ac) active = null;
    }
  }

  function cancel() {
    if (!active) return false;
    active.cancelled = true;
    killTree(active.child);
    return true;
  }

  return { start, cancel };
}

module.exports = { createGeneration, validateRequest };
