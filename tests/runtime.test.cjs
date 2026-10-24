const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { collectRuntime } = require('../desktop/runtime.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hunyuan-runtime-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function write(root, name, content) {
  const file = path.join(root, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

test('an empty workspace never claims models or AI are ready', async t => {
  const root = await fixture(t);
  const data = await collectRuntime(root);
  assert.equal(data.ready, false);
  assert.equal(data.environmentReady, false);
  assert.equal(data.inferenceVerified, false);
  assert.equal(data.generationAvailable, false);
  assert.ok(data.models.every(model => !model.complete && model.downloadedMiB === 0));
  assert.equal(data.hardware, null);
});

test('read current hardware without loading models and count partial downloads', async t => {
  const root = await fixture(t);
  await write(root, '.venv-ai/Scripts/python.exe', 'test fixture');
  await write(root, 'outputs/setup/diagnose.json', JSON.stringify({ ok: true, imports_ok: true, cuda_available: true }));
  await write(root, 'models/tencent/Hunyuan3D-2mini/.cache/huggingface/download/test.incomplete', Buffer.alloc(2 * 1024 ** 2));
  const data = await collectRuntime(root, async (command, args, options) => {
    assert.equal(command, path.join(root, '.venv-ai', 'Scripts', 'python.exe'));
    assert.equal(args[1], 'diagnose');
    assert.equal(options.timeout, 15000);
    return { stdout: JSON.stringify({ ok: true, gpu: 'RTX fixture', ram_free_gib: 2, vram_free_mib: 2400 }) };
  });
  assert.equal(data.gpu, 'RTX fixture');
  assert.equal(data.environmentReady, true);
  assert.equal(data.models[0].downloadedMiB, 2);
  assert.equal(data.models[0].complete, false);
  assert.equal(data.hardware.vram_free_mib, 2400);
  assert.equal(data.ready, false);
});

test('missing config does not mark the shape model complete', async t => {
  const root = await fixture(t);
  await write(root, 'models/tencent/Hunyuan3D-2mini/hunyuan3d-dit-v2-mini/model.fp16.safetensors', 'checkpoint fixture');
  let data = await collectRuntime(root);
  assert.equal(data.models[0].complete, false);
  await write(root, 'models/tencent/Hunyuan3D-2mini/hunyuan3d-dit-v2-mini/config.yaml', 'model: test');
  data = await collectRuntime(root);
  assert.equal(data.models[0].complete, true);
  assert.equal(data.inferenceVerified, false);
  assert.equal(data.generationAvailable, false);
});

test('download errors are reported and truncated JSON is not success', async t => {
  const root = await fixture(t);
  await write(root, 'outputs/setup/download.exit', '1\n');
  await write(root, 'outputs/setup/download.json', JSON.stringify({ ok: false, error: 'Network unavailable' }));
  await write(root, 'outputs/setup/diagnose.json', '{');
  const data = await collectRuntime(root);
  assert.match(data.downloadState, /ข้อผิดพลาด/);
  assert.equal(data.error, 'Network unavailable');
  assert.equal(data.environmentReady, false);
});

test('failed live hardware diagnosis does not show old free memory as current', async t => {
  const root = await fixture(t);
  await write(root, '.venv-ai/Scripts/python.exe', 'test fixture');
  await write(root, 'outputs/setup/hardware.json', JSON.stringify({ gpu: 'Old GPU', ram_free_gib: 14 }));
  const data = await collectRuntime(root, async () => { throw new Error('timeout'); });
  assert.equal(data.hardware, null);
  assert.match(data.error, /ไม่สำเร็จ/);
  assert.notEqual(data.gpu, 'Old GPU');
});
